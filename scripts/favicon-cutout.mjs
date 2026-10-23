// Usage: node scripts/favicon-cutout.mjs <avatar.jpg> public/favicon.png [threshold=60]
// Remove the dark background around the cat using a browser canvas (no extra dependencies).
// Background = dark pixels connected to the image border; enclosed dark parts (pupils) stay.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out, T = '60'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
const res = await p.evaluate(async ({ dataUrl, T }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = img.width, H = img.height;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, W, H);
  const px = d.data;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
  // Flood fill dark pixels from the border.
  const bg = new Uint8Array(W * H);
  const q = [];
  const push = (i) => { if (!bg[i] && lum[i] < T) { bg[i] = 1; q.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
  // Drop small foreground specks (noise) not connected to the cat.
  const comp = new Int32Array(W * H).fill(-1);
  const sizes = [];
  for (let s = 0; s < W * H; s++) {
    if (bg[s] || comp[s] >= 0) continue;
    const id = sizes.length; let n = 0; const st = [s]; comp[s] = id;
    while (st.length) {
      const i = st.pop(); n++;
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !bg[j] && comp[j] < 0) { comp[j] = id; st.push(j); }
      }
    }
    sizes.push(n);
  }
  const keepMin = 40;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let i = 0; i < W * H; i++) {
    const fg = !bg[i] && sizes[comp[i]] >= keepMin;
    // Soft edge: foreground pixels only a little brighter than the threshold get partial alpha.
    px[4 * i + 3] = fg ? Math.round(255 * Math.min(1, Math.max(0.35, (lum[i] - T) / 40 + 0.35))) : 0;
    const touchesBg = fg && [i - 1, i + 1, i - W, i + W].some((j) => j >= 0 && j < W * H && bg[j]);
    if (fg && !touchesBg) px[4 * i + 3] = 255;
    if (fg) { const x = i % W, y = (i / W) | 0; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  ctx.putImageData(d, 0, 0);
  // Crop to the cat, square, 128 px.
  const side = Math.max(maxX - minX, maxY - minY) + 1;
  const o = new OffscreenCanvas(128, 128);
  const octx = o.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  octx.drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, 128, 128);
  const blob = await o.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (const v of buf) bin += String.fromCharCode(v);
  return { png: btoa(bin), box: [minX, minY, maxX, maxY], bgShare: bg.reduce((a, v) => a + v, 0) / (W * H), comps: sizes.filter((s) => s >= keepMin).length };
}, { dataUrl: `data:image/jpeg;base64,${readFileSync(src).toString('base64')}`, T: Number(T) });
writeFileSync(out, Buffer.from(res.png, 'base64'));
console.log('box', res.box, 'background', (res.bgShare * 100).toFixed(1) + '%', 'kept parts', res.comps);
await b.close();
