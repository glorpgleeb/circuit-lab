// SI-prefix parsing ("4.7k", "100n", "2.2uH", "4k7", "2R2") and display ("4.7 kΩ").
import { Rational } from './rational';

export const PREFIX_EXP: Record<string, number> = {
  f: -15, p: -12, n: -9, u: -6, µ: -6, μ: -6, m: -3, k: 3, K: 3, M: 6, G: 9, T: 12,
};
const DISPLAY_PREFIX: Record<number, string> = {
  [-15]: 'f', [-12]: 'p', [-9]: 'n', [-6]: 'µ', [-3]: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T',
};

export type Parsed = { value: Rational; unit: string } | { error: string };

/**
 * Parse a number with optional SI prefix and unit, exactly.
 * "m" is milli and "M" is mega. A letter is a prefix only when it is a known prefix
 * and either stands alone or is followed by a unit ("mA", "kΩ").
 */
export function parseSI(input: string): Parsed {
  const s = input.trim().replace(/\s+/g, '');
  if (s === '') return { error: 'Valeur vide' };

  // RKM / resistor notation: 4k7 = 4.7k, 2R2 = 2.2, 1M5 = 1.5M
  const rkm = /^([+-]?\d+)([RrkKMGmunpµμ])(\d+)(.*)$/.exec(s);
  if (rkm) {
    const [, int, letter, frac, unit] = rkm;
    const exp = letter === 'R' || letter === 'r' ? 0 : PREFIX_EXP[letter];
    const v = Rational.parseDecimal(`${int}.${frac}`)!;
    return { value: v.mul(Rational.scaled(1, exp)), unit };
  }

  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/.exec(s);
  if (!m) return { error: `Pas un nombre : "${input.trim()}"` };
  const [, num, rest] = m;
  const value = Rational.parseDecimal(num)!;
  if (rest === '') return { value, unit: '' };
  const first = rest[0];
  if (Object.hasOwn(PREFIX_EXP, first)) {
    return { value: value.mul(Rational.scaled(1, PREFIX_EXP[first])), unit: rest.slice(1) };
  }
  if (/^[A-Za-zΩ°%][A-Za-z0-9Ω°/^*·]*$/.test(rest)) return { value, unit: rest };
  return { error: `Pas un nombre : "${input.trim()}"` };
}

/** Format with the best SI prefix and `sig` significant digits: 4700 -> "4.7 k". Never prints NaN. */
export function formatSI(x: number, unit = '', sig = 4): string {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return `0 ${unit}`.trim();
  let e = Math.floor(Math.log10(Math.abs(x)) / 3) * 3;
  e = Math.min(12, Math.max(-15, e));
  let mant = Number((x / 10 ** e).toPrecision(sig));
  if (Math.abs(mant) >= 1000 && e < 12) {
    e += 3;
    mant = Number((x / 10 ** e).toPrecision(sig));
  }
  return `${mant} ${DISPLAY_PREFIX[e]}${unit}`.trim();
}

/** Signed percentage with 3 significant digits: 0.0123 -> "+1.23 %". */
export function formatPercent(frac: number, signed = true, sig = 3): string {
  if (!Number.isFinite(frac)) return '—';
  if (frac === 0) return '0 %';
  const p = Number((frac * 100).toPrecision(sig));
  return `${signed && p > 0 ? '+' : ''}${p} %`;
}

/** Plain number for dimensionless or unit-less results: 0.275, 1234, 7.975e-6. */
export function formatPlain(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a === 0 || (a >= 1e-3 && a < 1e6)) return String(Number(x.toPrecision(sig)));
  return x.toExponential(sig - 1).replace(/\.?0+e/, 'e').replace('e+', 'e');
}
