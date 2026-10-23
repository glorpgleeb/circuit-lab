// Physical dimensions as exponent vectors over SI base units [kg, m, s, A, K].
// Used to infer result units and to warn when incompatible units are mixed.
import { PREFIX_EXP } from './si';

export type Dims = readonly number[]; // length 5
export const DIMLESS: Dims = [0, 0, 0, 0, 0];
const BASE = ['kg', 'm', 's', 'A', 'K'];

// Named units, in display preference order (first match wins when naming a dimension).
const NAMED: [string, Dims][] = [
  ['V', [1, 2, -3, -1, 0]],
  ['A', [0, 0, 0, 1, 0]],
  ['Ω', [1, 2, -3, -2, 0]],
  ['F', [-1, -2, 4, 2, 0]],
  ['H', [1, 2, -2, -2, 0]],
  ['Hz', [0, 0, -1, 0, 0]],
  ['s', [0, 0, 1, 0, 0]],
  ['W', [1, 2, -3, 0, 0]],
  ['J', [1, 2, -2, 0, 0]],
  ['C', [0, 0, 1, 1, 0]],
  ['S', [-1, -2, 3, 2, 0]],
  ['Wb', [1, 2, -2, -1, 0]],
  ['T', [1, 0, -2, -1, 0]],
  ['m', [0, 1, 0, 0, 0]],
  ['K', [0, 0, 0, 0, 1]],
  ['V/s', [1, 2, -4, -1, 0]],
  ['A/s', [0, 0, -1, 1, 0]],
];
const ALIASES = new Map([['ohm', 'Ω'], ['Ohm', 'Ω'], ['ohms', 'Ω']]);
const LOOKUP = new Map<string, Dims>(NAMED.filter(([n]) => !n.includes('/')));

export interface Unit {
  dims: Dims;
  scale: number; // value in SI base = value × scale
}

export const eqDims = (a: Dims, b: Dims) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
export const mulDims = (a: Dims, b: Dims, sign = 1): Dims => a.map((x, i) => x + sign * b[i]);
export const powDims = (a: Dims, k: number): Dims => a.map((x) => x * k);
export const isDimless = (a: Dims) => eqDims(a, DIMLESS);

function term(t: string): Unit | null {
  const name = ALIASES.get(t) ?? t;
  if (name === '1') return { dims: DIMLESS, scale: 1 };
  const exact = LOOKUP.get(name);
  if (exact) return { dims: exact, scale: 1 };
  // Prefixed unit: "mA", "kHz", "µF". An exact match wins first, so "m" is metre, "T" is tesla.
  const p = Object.hasOwn(PREFIX_EXP, name[0]) ? PREFIX_EXP[name[0]] : undefined;
  const rest = ALIASES.get(name.slice(1)) ?? name.slice(1);
  const base = rest ? LOOKUP.get(rest) : undefined;
  if (p !== undefined && base) return { dims: base, scale: 10 ** p };
  return null;
}

/** Parse "V", "mA", "kHz", "V/us", "A^2", "Ω*F". Empty string means "not specified" (null). */
export function parseUnit(s: string): Unit | null | { error: string } {
  const src = s.trim().replace(/\s+/g, '');
  if (src === '') return null;
  let dims: Dims = DIMLESS;
  let scale = 1;
  const re = /([*·/]?)([^*·/^]+)(?:\^(-?\d+(?:\.\d+)?))?/gy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < src.length && (m = re.exec(src))) {
    pos = re.lastIndex;
    const [, op, name, expStr] = m;
    const u = term(name);
    if (!u) return { error: `Unité inconnue "${name}"` };
    const k = (expStr ? Number(expStr) : 1) * (op === '/' ? -1 : 1);
    dims = mulDims(dims, powDims(u.dims, k));
    scale *= u.scale ** k;
  }
  if (pos !== src.length) return { error: `Unité illisible "${s.trim()}"` };
  return { dims, scale };
}

const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** Display name for a dimension: a named unit if one matches, else SI base units ("kg·m²·s⁻³"). */
export function unitName(d: Dims): string {
  if (isDimless(d)) return '';
  const named = NAMED.find(([, nd]) => eqDims(nd, d));
  if (named) return named[0];
  return d
    .map((x, i) => {
      if (x === 0) return '';
      if (x === 1) return BASE[i];
      const k = +x.toFixed(3);
      return Number.isInteger(k) ? BASE[i] + String(k).replace(/./g, (c) => SUP[c] ?? c) : `${BASE[i]}^${k}`;
    })
    .filter(Boolean)
    .join('·');
}
