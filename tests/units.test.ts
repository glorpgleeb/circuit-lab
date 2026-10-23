import { describe, expect, it } from 'vitest';
import { Rational } from '../src/units/rational';
import { formatPercent, formatSI, parseSI } from '../src/units/si';

const val = (s: string) => {
  const p = parseSI(s);
  if ('error' in p) throw new Error(p.error);
  return p;
};

describe('Rational', () => {
  it('is exact where floats are not', () => {
    const a = Rational.parseDecimal('0.1')!.add(Rational.parseDecimal('0.2')!);
    expect(a.eq(Rational.parseDecimal('0.3')!)).toBe(true);
    expect(0.1 + 0.2 === 0.3).toBe(false);
  });
  it('normalises and compares', () => {
    expect(new Rational(6n, -4n).toString()).toBe('-3/2');
    expect(Rational.parseDecimal('1e-3')!.toString()).toBe('1/1000');
    expect(Rational.parseDecimal('2.50')!.cmp(Rational.parseDecimal('2.5')!)).toBe(0);
  });
  it('rejects junk and division by zero', () => {
    expect(Rational.parseDecimal('abc')).toBeNull();
    expect(Rational.parseDecimal('.')).toBeNull();
    expect(() => Rational.ONE.div(Rational.ZERO)).toThrow(RangeError);
  });
});

describe('parseSI', () => {
  it.each([
    ['4.7k', '4700', ''],
    ['100n', '1/10000000', ''],
    ['3.3', '33/10', ''],
    ['2.2u', '11/5000000', ''],
    ['2.2µH', '11/5000000', 'H'],
    ['1M', '1000000', ''],
    ['1m', '1/1000', ''],
    ['100mV', '1/10', 'V'],
    ['4k7', '4700', ''],
    ['2R2', '11/5', ''],
    ['1M5Ω', '1500000', 'Ω'],
    ['10 kΩ', '10000', 'Ω'],
    ['5V', '5', 'V'],
    ['1e3', '1000', ''],
    ['-0.5', '-1/2', ''],
  ])('%s', (s, exact, unit) => {
    const p = val(s);
    expect(p.value.toString()).toBe(exact);
    expect(p.unit).toBe(unit);
  });
  it('gives clear errors', () => {
    expect(parseSI('')).toEqual({ error: 'Valeur vide' });
    expect(parseSI('abc')).toEqual({ error: 'Pas un nombre : "abc"' });
    expect(parseSI('1..2')).toHaveProperty('error');
  });
});

describe('formatSI', () => {
  it.each([
    [4.7e-6, 'H', '4.7 µH'],
    [1.2e6, 'Hz', '1.2 MHz'],
    [4700, 'Ω', '4.7 kΩ'],
    [0.1 + 0.2, 'V', '300 mV'],
    [999.96, 'Ω', '1 kΩ'],
    [0, 'A', '0 A'],
    [-3.3, 'V', '-3.3 V'],
    [NaN, 'V', '—'],
    [Infinity, '', '—'],
  ])('%s %s', (x, unit, out) => expect(formatSI(x, unit)).toBe(out));
  it('formats percentages', () => {
    expect(formatPercent(0.0123)).toBe('+1.23 %');
    expect(formatPercent(-0.000456)).toBe('-0.0456 %');
    expect(formatPercent(0)).toBe('0 %');
  });
});
