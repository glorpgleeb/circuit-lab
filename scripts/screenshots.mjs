// Starts the Vite dev server, opens each page in headless Chromium (light and dark),
// saves PNGs to screenshots/, and fails on any console error.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Each shot: name, page hash, optional actions before the screenshot.
const SHOTS = [
  { name: 'equations-buck', hash: 'equations' },
  {
    name: 'equations-solve-fsw',
    hash: 'equations',
    run: async (p) => {
      await p.check('input[name="unknown"][value="fsw"]');
      await p.fill('input[data-name="L"][data-field="value"]', '10u');
    },
  },
  {
    name: 'equations-solve-vout',
    hash: 'equations',
    run: async (p) => {
      await p.check('input[name="unknown"][value="Vout"]');
      await p.fill('input[data-name="L"][data-field="value"]', '7.975u');
    },
  },
  {
    name: 'equations-errors',
    hash: 'equations',
    run: async (p) => {
      await p.check('input[name="unknown"][value=""]');
      await p.fill('#eq-text', 'Pd = V * I + R\nR = V / I\na = b + 1\nb = 2 * a\nq = sqrt(V - 10)\nz = Pd * k');
      await p.press('#eq-text', 'Control+Enter');
      await p.fill('input[data-name="V"][data-field="value"]', '5');
      await p.fill('input[data-name="V"][data-field="unit"]', 'V');
      await p.fill('input[data-name="I"][data-field="value"]', '0');
      await p.fill('input[data-name="I"][data-field="unit"]', 'A');
      await p.fill('input[data-name="k"][data-field="value"]', '4.7q');
    },
  },
  {
    name: 'equations-module-divider',
    hash: 'equations',
    run: async (p) => {
      await p.selectOption('#mod-select', 'builtin-voltage-divider');
    },
  },
  {
    name: 'solver-from-module',
    hash: 'equations',
    run: async (p) => {
      await p.selectOption('#mod-select', 'builtin-feedback-divider');
      await p.fill('input[data-name="Vref"][data-field="value"]', '0.6');
      await p.click('#best-R1 button');
      await p.waitForSelector('#solver-form');
    },
  },
  {
    name: 'equations-module-saved-imported',
    hash: 'equations',
    run: async (p) => {
      await p.fill('#mod-name', 'My 5V buck');
      await p.fill('#mod-tags', 'power, buck, 5V');
      await p.fill('input[data-name="Vout"][data-field="value"]', '5');
      await p.click('#mod-saveas');
      const file = JSON.stringify({ format: 'circuit-lab-modules', version: 1, modules: [
        { name: 'Op-amp gain', tags: ['opamp'], formulas: 'G = 1 + Rf / Rg', variables: { Rf: { value: '47k', unit: 'Ω' }, Rg: { value: '10k', unit: 'Ω' } } },
        { name: 'Bad one', formulas: 'x = import("fs")' },
      ] });
      await p.setInputFiles('#mod-file', { name: 'mods.json', mimeType: 'application/json', buffer: Buffer.from(file) });
      await p.waitForSelector('#mod-msgs li');
    },
  },
  { name: 'solver-divider', hash: 'solver' },
  {
    name: 'solver-no-solution',
    hash: 'solver',
    run: async (p) => {
      await p.selectOption('#mode', 'single');
      await p.fill('#f-rt', '1.06k');
      await p.fill('#precision', '0.5');
      await p.selectOption('#check', 'nominal');
      await p.press('#precision', 'Enter');
    },
  },
  {
    name: 'solver-pairs',
    hash: 'solver',
    run: async (p) => {
      await p.selectOption('#mode', 'feedback');
      await p.selectOption('#series', 'E12');
      await p.fill('#precision', '0.2');
      await p.check('#combos');
      await p.fill('#f-vout', '5');
      await p.press('#f-vout', 'Enter');
    },
  },
];
const THEMES = ['light', 'dark', 'black', 'purple'];

const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: true } });
await server.listen();
const base = 'http://localhost:5199/';
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch();
const errors = [];
try {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('circuit-lab.theme', t), theme);
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    for (const shot of SHOTS) {
      await page.goto(`${base}?shot=${shot.name}#/${shot.hash}`); // query forces a fresh page load
      await page.waitForLoadState('networkidle');
      if (shot.run) await shot.run(page);
      await page.waitForFunction(() => !document.body.textContent.includes('Recherche…'));
      const file = `screenshots/${shot.name}-${theme}.png`;
      await page.screenshot({ path: file });
      console.log('saved', file);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error('Console errors:\n' + errors.join('\n'));
  process.exit(1);
}
