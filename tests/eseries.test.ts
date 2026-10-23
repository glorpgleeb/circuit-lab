import { describe, expect, it } from 'vitest';
import { SERIES_NAMES, TABLES, seriesValues } from '../src/solver/eseries';
import { Rational } from '../src/units/rational';

const formula = (n: number, digits: number, i: number) =>
  Math.round(10 ** (digits - 1) * 10 ** (i / n));

describe('E-series tables (IEC 60063)', () => {
  it('have the right length, are strictly increasing and start at 1.0', () => {
    for (const name of SERIES_NAMES) {
      const t = TABLES[name];
      expect(t.length).toBe(Number(name.slice(1)));
      expect(t[0]).toBe(t[0] >= 100 ? 100 : 10);
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    }
  });

  it('nest: each series is every other value of the next finer one', () => {
    const pairs: [string, string][] = [['E6', 'E12'], ['E12', 'E24'], ['E48', 'E96'], ['E96', 'E192']];
    for (const [coarse, fine] of pairs) {
      const f = TABLES[fine as 'E12'];
      expect(TABLES[coarse as 'E6']).toEqual(f.filter((_, i) => i % 2 === 0));
    }
  });

  it('E24 is the official table, not the rounded formula (deviates at 2.7–4.7 and 8.2)', () => {
    const diffs = TABLES.E24.map((v, i) => (v === formula(24, 2, i) ? null : v)).filter((v) => v !== null);
    expect(diffs).toEqual([27, 30, 33, 36, 39, 43, 47, 82]);
  });

  it('E192 matches the formula except the official 920 (formula: 919)', () => {
    const diffs = TABLES.E192.map((v, i) => (v === formula(192, 3, i) ? null : [v, formula(192, 3, i)]))
      .filter((v) => v !== null);
    expect(diffs).toEqual([[920, 919]]);
  });

  it('E96 and E48 equal the formula exactly', () => {
    TABLES.E96.forEach((v, i) => expect(v).toBe(formula(96, 3, i)));
    TABLES.E48.forEach((v, i) => expect(v).toBe(formula(48, 3, i)));
  });

  it('spot-checks known catalogue values', () => {
    expect(TABLES.E96).toContain(499);
    expect(TABLES.E96).toContain(976);
    expect(TABLES.E48).toContain(953);
    expect(TABLES.E192).toContain(988);
    expect(TABLES.E12).toEqual([10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82]);
    expect(TABLES.E6).toEqual([10, 15, 22, 33, 47, 68]);
  });
});

describe('seriesValues', () => {
  const R = (s: string) => Rational.parseDecimal(s)!;

  it('covers one decade exactly, bounds inclusive', () => {
    const v = seriesValues('E24', R('1'), R('9.1'));
    expect(v.length).toBe(24);
    expect(v[0].value.eq(R('1'))).toBe(true);
    expect(v[23].value.eq(R('9.1'))).toBe(true);
  });

  it('handles extreme decades (1 mΩ and 1 GΩ)', () => {
    const low = seriesValues('E6', R('0.001'), R('0.001'));
    expect(low.map((p) => p.value.toString())).toEqual(['1/1000']);
    const high = seriesValues('E96', R('976e6'), R('1e9'));
    expect(high.map((p) => p.value.toString())).toEqual(['976000000', '1000000000']);
  });

  it('returns nothing for an empty range', () => {
    expect(seriesValues('E12', R('1.3'), R('1.4'))).toEqual([]);
  });
});
