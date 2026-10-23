// Exact E-series resistor solver.
//
// Search runs on floats (fast) and keeps the best candidates per part count.
// Every kept candidate is then re-evaluated with exact rationals: the pass/fail
// decision against the precision limit, worst-case error and limits never use floats.
//
// Kinds (A = R1, B = R2):
//   single  : R               (target resistance)
//   divider : B / (A + B)     (Vout / Vin, R1 on top)
//   ratio   : A / B           (e.g. inverting gain)
//   gain    : 1 + A / B       (feedback divider Vout = Vref·(1 + R1/R2), non-inverting gain)
import { Rational } from '../units/rational';
import { formatPercent, formatSI } from '../units/si';
import { R_MAX, R_MIN, SERIES_NAMES, seriesValues, type Part, type SeriesName } from './eseries';

export type Kind = 'single' | 'divider' | 'ratio' | 'gain';
export type Topology = 'single' | 'series' | 'parallel';

export interface SolveInput {
  kind: Kind;
  target: Rational;
  series: SeriesName;
  tolerance: Rational; // fraction, 1% = 1/100
  precision: Rational; // fraction, ±1% = 1/100
  check: 'worst' | 'nominal'; // which error must stay within ±precision
  minR: Rational;
  maxR: Rational;
  combos: boolean; // allow series/parallel pairs per position
  voltage?: Rational; // voltage across the whole network, for current/power limits
  maxCurrent?: Rational;
  maxPower?: Rational; // per physical resistor
  limit?: number; // solutions returned (default 20)
  suggest?: boolean; // compute alternatives when nothing passes (default true)
}

export interface Position {
  topology: Topology;
  parts: Part[];
  value: Rational;
}

export interface Solution {
  positions: Position[]; // [R] or [R1, R2]
  nominal: Rational; // exact network result (R, ratio or gain)
  nominalErr: number; // signed fraction, for display
  worstErr: number; // max |error| over tolerance corners, fraction
  pass: boolean; // decided exactly
  parts: number;
  current?: number; // A, when voltage is known
  maxPartPower?: number; // W, when voltage is known
  variants: number; // other decade-scaled copies with the same result
}

export type SolveResult =
  | { ok: true; solutions: Solution[]; best?: Solution; message: string; suggestions: string[] }
  | { ok: false; error: string };

const fmtPct = (r: Rational) => `${Number((r.toNumber() * 100).toPrecision(4))} %`;

// ---------- candidate sets (float, for search) ----------

interface CandSet {
  val: Float64Array;
  a: Int32Array; // index into parts
  b: Int32Array; // second part index or -1
  topo: Uint8Array; // 0 single, 1 series, 2 parallel
  size: number;
}
const TOPO: Topology[] = ['single', 'series', 'parallel'];

function buildSet(parts: Part[], combos: boolean): CandSet {
  const n = parts.length;
  const size = combos ? n * (n + 1) : n; // series + parallel pairs (i <= j)
  const raw = { val: new Float64Array(size), a: new Int32Array(size), b: new Int32Array(size), topo: new Uint8Array(size) };
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!combos) {
      raw.val[k] = parts[i].num;
      raw.a[k] = i;
      raw.b[k] = -1;
      k++;
      continue;
    }
    for (let j = i; j < n; j++) {
      const x = parts[i].num;
      const y = parts[j].num;
      raw.val[k] = x + y; raw.a[k] = i; raw.b[k] = j; raw.topo[k] = 1; k++;
      raw.val[k] = (x * y) / (x + y); raw.a[k] = i; raw.b[k] = j; raw.topo[k] = 2; k++;
    }
  }
  // sort by value (binary search needs it)
  const order = new Uint32Array(size);
  for (let i = 0; i < size; i++) order[i] = i;
  order.sort((x, y) => raw.val[x] - raw.val[y]);
  const s: CandSet = { val: new Float64Array(size), a: new Int32Array(size), b: new Int32Array(size), topo: new Uint8Array(size), size };
  for (let i = 0; i < size; i++) {
    const o = order[i];
    s.val[i] = raw.val[o]; s.a[i] = raw.a[o]; s.b[i] = raw.b[o]; s.topo[i] = raw.topo[o];
  }
  return s;
}

function lowerBound(arr: Float64Array, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------- bounded max-heap of best candidates (by float error) ----------

interface Cand { err: number; sa: CandSet; ka: number; sb?: CandSet; kb: number }

class TopK {
  items: Cand[] = [];
  readonly k: number;
  constructor(k: number) {
    this.k = k;
  }
  worst(): number {
    return this.items.length < this.k ? Infinity : this.items[0].err;
  }
  push(c: Cand): void {
    const h = this.items;
    if (h.length < this.k) {
      h.push(c);
      let i = h.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (h[p].err >= h[i].err) break;
        [h[p], h[i]] = [h[i], h[p]];
        i = p;
      }
    } else if (c.err < h[0].err) {
      h[0] = c;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && h[l].err > h[m].err) m = l;
        if (r < h.length && h[r].err > h[m].err) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
  }
}

// ---------- network math ----------

function fFloat(kind: Kind, a: number, b: number): number {
  switch (kind) {
    case 'single': return a;
    case 'divider': return b / (a + b);
    case 'ratio': return a / b;
    case 'gain': return 1 + a / b;
  }
}

/** R2 that gives the exact target for a given R1. */
function idealB(kind: Kind, a: number, t: number): number {
  switch (kind) {
    case 'divider': return (a * t) / (1 - t);
    case 'ratio': return a / t;
    case 'gain': return a / (t - 1);
    default: return NaN;
  }
}

function fExact(kind: Kind, a: Rational, b?: Rational): Rational {
  switch (kind) {
    case 'single': return a;
    case 'divider': return b!.div(a.add(b!));
    case 'ratio': return a.div(b!);
    case 'gain': return Rational.ONE.add(a.div(b!));
  }
}

function position(set: CandSet, k: number, parts: Part[]): Position {
  const topology = TOPO[set.topo[k]];
  if (topology === 'single') {
    const p = parts[set.a[k]];
    return { topology, parts: [p], value: p.value };
  }
  const x = parts[set.a[k]];
  const y = parts[set.b[k]];
  const value = topology === 'series' ? x.value.add(y.value) : x.value.mul(y.value).div(x.value.add(y.value));
  return { topology, parts: [x, y], value };
}

/** Power in each physical resistor of a position, given the current through it. */
function partPowers(pos: Position, current: Rational): Rational[] {
  if (pos.topology === 'parallel') {
    const v = current.mul(pos.value);
    return pos.parts.map((p) => v.mul(v).div(p.value));
  }
  return pos.parts.map((p) => current.mul(current).mul(p.value));
}

// ---------- validation ----------

function validate(inp: SolveInput): string | null {
  const t = inp.target;
  if (t.sign() <= 0) return 'La cible doit être supérieure à 0.';
  if (inp.kind === 'divider' && !t.lt(Rational.ONE)) return 'Le rapport du diviseur Vout/Vin doit être entre 0 et 1 (Vout < Vin).';
  if (inp.kind === 'gain' && !Rational.ONE.lt(t)) return 'Le gain 1 + R1/R2 doit être supérieur à 1 (Vout > Vref).';
  if (inp.precision.sign() <= 0) return 'La précision doit être supérieure à 0.';
  if (inp.tolerance.sign() < 0 || !inp.tolerance.lt(Rational.ONE)) return 'La tolérance doit être entre 0 et 100 %.';
  if (inp.minR.sign() <= 0) return 'La résistance minimale doit être supérieure à 0.';
  if (inp.maxR.lt(inp.minR)) return 'La résistance minimale dépasse la maximale.';
  if (inp.maxR.lt(R_MIN) || R_MAX.lt(inp.minR)) return 'La plage de résistances doit recouper 1 mΩ … 1 GΩ.';
  if ((inp.maxCurrent || inp.maxPower) && !inp.voltage) return 'Le courant max et la puissance max nécessitent la tension aux bornes du réseau.';
  return null;
}

// ---------- solver ----------

const HEAP_K = 600;
const LENIENT = 1 + 1e-9; // float pre-filter is lenient; the exact check decides

export function solve(inp: SolveInput): SolveResult {
  const bad = validate(inp);
  if (bad) return { ok: false, error: bad };

  const minR = inp.minR.lt(R_MIN) ? R_MIN : inp.minR;
  const maxR = R_MAX.lt(inp.maxR) ? R_MAX : inp.maxR;
  const parts = seriesValues(inp.series, minR, maxR);
  if (parts.length === 0) {
    return { ok: false, error: `Aucune valeur ${inp.series} entre R min et R max.` };
  }

  const T = inp.target.toNumber();
  const V = inp.voltage?.toNumber();
  const Imax = inp.maxCurrent?.toNumber();
  const Pmax = inp.maxPower?.toNumber();

  // Lenient float check of current/power limits (exact check follows).
  const limitsOk = (ra: number, rb: number, sa: CandSet, ka: number, sb?: CandSet, kb = 0): boolean => {
    if (V === undefined) return true;
    const total = inp.kind === 'single' ? ra : ra + rb;
    const I = V / total;
    if (Imax !== undefined && I > Imax * LENIENT) return false;
    if (Pmax !== undefined) {
      const check = (s: CandSet, k: number, r: number) => {
        const x = parts[s.a[k]].num;
        if (s.topo[k] === 2) {
          const y = parts[s.b[k]].num;
          const v = I * r;
          return (v * v) / Math.min(x, y) <= Pmax * LENIENT;
        }
        const big = s.topo[k] === 1 ? Math.max(x, parts[s.b[k]].num) : x;
        return I * I * big <= Pmax * LENIENT;
      };
      if (!check(sa, ka, ra)) return false;
      if (sb && !check(sb, kb, rb)) return false;
    }
    return true;
  };

  const singles = buildSet(parts, false);
  const pairs = inp.combos ? buildSet(parts, true) : undefined;
  // One heap per part count, so a 2-part answer is never crowded out by 4-part ones.
  const heaps = new Map<number, TopK>();
  const heap = (n: number) => heaps.get(n) ?? heaps.set(n, new TopK(HEAP_K)).get(n)!;

  const searchSingle = (s: CandSet, nParts: number) => {
    const h = heap(nParts);
    for (let k = 0; k < s.size; k++) {
      const err = Math.abs(s.val[k] - T) / T;
      if (err < h.worst() && limitsOk(s.val[k], 0, s, k)) h.push({ err, sa: s, ka: k, kb: -1 });
    }
  };

  const searchPair = (sa: CandSet, sb: CandSet, nParts: number) => {
    const h = heap(nParts);
    for (let ka = 0; ka < sa.size; ka++) {
      const a = sa.val[ka];
      const ideal = idealB(inp.kind, a, T);
      if (!(ideal > 0) || !Number.isFinite(ideal)) continue;
      const idx = lowerBound(sb.val, ideal);
      // f is monotonic in R2, so the two neighbours of the ideal value are the best for this R1
      for (const kb of [idx - 1, idx]) {
        if (kb < 0 || kb >= sb.size) continue;
        const b = sb.val[kb];
        const err = Math.abs(fFloat(inp.kind, a, b) - T) / T;
        if (err < h.worst() && limitsOk(a, b, sa, ka, sb, kb)) h.push({ err, sa, ka, sb, kb });
      }
    }
  };

  if (inp.kind === 'single') {
    searchSingle(singles, 1);
    if (pairs) searchSingle(pairs, 2);
  } else {
    searchPair(singles, singles, 2);
    if (pairs) {
      searchPair(pairs, singles, 3);
      searchPair(singles, pairs, 3);
      searchPair(pairs, pairs, 4);
    }
  }

  // ---- exact evaluation ----
  const tol = inp.tolerance;
  const lo = Rational.ONE.sub(tol);
  const hi = Rational.ONE.add(tol);
  const limitAbs = inp.precision.mul(inp.target); // |result - target| must be <= this
  const center = Math.sqrt(minR.toNumber() * maxR.toNumber());

  const exact: (Solution & { key: string; spread: number })[] = [];
  for (const h of heaps.values()) {
    for (const c of h.items) {
      const positions = [position(c.sa, c.ka, parts)];
      if (c.sb) positions.push(position(c.sb, c.kb, parts));
      const [A, B] = positions.map((p) => p.value);
      const nominal = fExact(inp.kind, A, B);
      const nomDev = nominal.sub(inp.target);

      // Tolerance corners: every position moves by (1 ± tol); f is monotonic in each.
      let worstDev = Rational.ZERO;
      for (const ka of [lo, hi]) {
        for (const kb of B ? [lo, hi] : [lo]) {
          const d = fExact(inp.kind, A.mul(ka), B?.mul(kb)).sub(inp.target).abs();
          if (worstDev.lt(d)) worstDev = d;
        }
      }

      // Exact limits.
      let current: Rational | undefined;
      let maxP: Rational | undefined;
      if (inp.voltage) {
        current = inp.voltage.div(B ? A.add(B) : A);
        const powers = positions.flatMap((p) => partPowers(p, current!));
        maxP = powers.reduce((m, p) => (m.lt(p) ? p : m));
        if (inp.maxCurrent && inp.maxCurrent.lt(current)) continue;
        if (inp.maxPower && inp.maxPower.lt(maxP)) continue;
      }

      const checked = inp.check === 'worst' ? worstDev : nomDev.abs();
      const nParts = positions.reduce((n, p) => n + p.parts.length, 0);
      const exp0 = positions[0].parts[0].exp;
      // Decade-scaled copies of a 2-resistor network give the same ratio: group them.
      const key = inp.kind === 'single'
        ? positions.map((p) => p.parts.map((x) => `${x.mant}e${x.exp}`).join(p.topology)).join('|')
        : positions.map((p) => p.parts.map((x) => `${x.mant}e${x.exp - exp0}`).join(p.topology)).join('|');
      const total = B ? A.add(B).toNumber() : A.toNumber();
      exact.push({
        positions,
        nominal,
        nominalErr: nomDev.div(inp.target).toNumber(),
        worstErr: worstDev.div(inp.target).toNumber(),
        pass: checked.le(limitAbs),
        parts: nParts,
        current: current?.toNumber(),
        maxPartPower: maxP?.toNumber(),
        variants: 0,
        key,
        spread: Math.abs(Math.log(total / center)),
      });
    }
  }

  // Keep one per decade-scaled group: the one nearest the middle of the allowed range.
  const groups = new Map<string, (typeof exact)[number]>();
  for (const s of exact) {
    const g = groups.get(s.key);
    if (!g) groups.set(s.key, s);
    else {
      const keep = s.spread < g.spread ? s : g;
      keep.variants = g.variants + 1;
      groups.set(s.key, keep);
    }
  }

  // Rank: passing first, then fewer parts, then smallest nominal error, then worst-case.
  const ranked = [...groups.values()].sort(
    (x, y) =>
      Number(y.pass) - Number(x.pass) ||
      x.parts - y.parts ||
      Math.abs(x.nominalErr) - Math.abs(y.nominalErr) ||
      x.worstErr - y.worstErr,
  );
  const solutions: Solution[] = ranked.slice(0, inp.limit ?? 20).map(({ key: _k, spread: _s, ...s }) => s);

  const checkName = inp.check === 'worst' ? 'pire cas' : 'nominal';
  const precisionTxt = `±${fmtPct(inp.precision)}`;
  if (solutions.length === 0) {
    return { ok: true, solutions, message: `Aucune combinaison ${inp.series} ne respecte les limites de courant et de puissance.`, suggestions: [] };
  }
  if (solutions[0].pass) {
    const n = solutions.filter((s) => s.pass).length;
    return {
      ok: true,
      solutions,
      best: solutions[0],
      message: `${n}${n === solutions.length ? '' : ` sur ${solutions.length}`} solutions en ${inp.series} respectent ${precisionTxt} (${checkName}, composants à ${fmtPct(tol)}).`,
      suggestions: [],
    };
  }

  // Nothing passes: closest = smallest checked error.
  const closest = [...solutions].sort((x, y) =>
    inp.check === 'worst' ? x.worstErr - y.worstErr : Math.abs(x.nominalErr) - Math.abs(y.nominalErr),
  )[0];
  return {
    ok: true,
    solutions,
    best: closest,
    message: `Aucune solution en ${inp.series} à ${precisionTxt}`,
    suggestions: inp.suggest === false ? [] : suggest(inp, closest, parts),
  };
}

// ---------- what would work instead ----------

const TOLERANCES = ['5', '2', '1', '0.5', '0.25', '0.1'].map((p) => Rational.parseDecimal(p)!.div(Rational.int(100)));

function suggest(inp: SolveInput, closest: Solution, parts: Part[]): string[] {
  const out: string[] = [];
  const passes = (over: Partial<SolveInput>) => {
    const r = solve({ ...inp, ...over, suggest: false, limit: 1 });
    return r.ok && r.solutions[0]?.pass ? r.solutions[0] : null;
  };
  const describe = (s: Solution) =>
    s.positions.map((p) => p.parts.map((x) => formatSI(x.num, 'Ω')).join(p.topology === 'series' ? ' + ' : ' || ')).join(', ');

  for (const series of SERIES_NAMES.slice(SERIES_NAMES.indexOf(inp.series) + 1)) {
    const s = passes({ series });
    if (s) {
      out.push(`Série plus fine : ${series} convient (ex. ${describe(s)}, pire cas ±${formatPercent(s.worstErr, false)}).`);
      break;
    }
  }
  if (inp.check === 'worst') {
    for (const tolerance of TOLERANCES.filter((t) => t.lt(inp.tolerance))) {
      if (passes({ tolerance })) {
        out.push(`Meilleure tolérance : des composants à ${fmtPct(tolerance)} en ${inp.series} conviennent.`);
        break;
      }
    }
  }
  if (!inp.combos && passes({ combos: true })) {
    out.push(`Combinaisons : des paires série/parallèle de valeurs ${inp.series} conviennent (cochez « Autoriser les paires »).`);
  }
  const edge = closest.positions.some((p) =>
    p.parts.some((x) => x.value.eq(parts[0].value) || x.value.eq(parts[parts.length - 1].value)),
  );
  if (edge) out.push('La solution la plus proche est en bord de plage : élargir R min/max peut aider.');
  if (out.length === 0) out.push("Aucune série plus fine, tolérance plus serrée ou paire n'atteint cette précision. Relâchez la précision.");
  return out;
}
