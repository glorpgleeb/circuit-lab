import { describe, expect, it } from 'vitest';
import { seriesValues } from '../src/solver/eseries';
import { solve, type Kind, type SolveInput } from '../src/solver/solve';
import { Rational } from '../src/units/rational';

const R = (s: string) => Rational.parseDecimal(s)!;
const pct = (s: string) => R(s).div(Rational.int(100));

const base = (over: Partial<SolveInput>): SolveInput => ({
  kind: 'single',
  target: R('1000'),
  series: 'E24',
  tolerance: pct('1'),
  precision: pct('1'),
  check: 'worst',
  minR: R('10'),
  maxR: R('1e6'),
  combos: false,
  ...over,
});

function ok(input: SolveInput) {
  const r = solve(input);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('exact boundaries', () => {
  it('target exactly on a value: zero error, worst-case exactly the tolerance, passes at the limit', () => {
    // In floats, 12 Ω with 1% tolerance gives a worst case of 1.0000000000000083% and would fail.
    expect(Math.abs(12 * 1.01 - 12) / 12 > 0.01).toBe(true);
    const r = ok(base({ target: R('12') }));
    const s = r.solutions[0];
    expect(s.positions[0].value.eq(R('12'))).toBe(true);
    expect(s.nominalErr).toBe(0);
    expect(s.worstErr).toBe(0.01);
    expect(s.pass).toBe(true);
  });

  it('divider R1 = R2 with 1% parts: worst-case ratio error is exactly 1%', () => {
    const r = ok(base({ kind: 'divider', target: R('0.5') }));
    const s = r.solutions[0];
    expect(s.positions[0].value.eq(s.positions[1].value)).toBe(true);
    expect(s.nominal.eq(R('0.5'))).toBe(true);
    expect(s.worstErr).toBe(0.01);
    expect(s.pass).toBe(true);
  });

  it('nominal error exactly at the precision limit passes', () => {
    // 1.01k in E192 vs target 1k: exactly +1%. Exclude 1.00k itself.
    const r = ok(base({ series: 'E192', target: R('1000'), minR: R('1010'), check: 'nominal' }));
    expect(r.solutions[0].positions[0].value.eq(R('1010'))).toBe(true);
    expect(r.solutions[0].pass).toBe(true);
  });
});

describe('optimality vs exact brute force', () => {
  const cases: [Kind, string][] = [
    ['divider', '0.66'], // 3.3 V from 5 V
    ['divider', '0.1234'],
    ['gain', '4.0303'], // 3.3 V from 0.8188 V ref-ish
    ['gain', '1.5'],
    ['ratio', '0.4545'],
    ['ratio', '7.3'],
  ];
  const f = (k: Kind, a: Rational, b: Rational) =>
    k === 'divider' ? b.div(a.add(b)) : k === 'ratio' ? a.div(b) : Rational.ONE.add(a.div(b));

  it.each(cases)('%s %s: best error equals brute-force minimum (E24, 1k–100k)', (kind, t) => {
    const target = R(t);
    const parts = seriesValues('E24', R('1000'), R('100000'));
    let best: Rational | null = null;
    for (const a of parts)
      for (const b of parts) {
        const d = f(kind, a.value, b.value).sub(target).abs();
        if (!best || d.lt(best)) best = d;
      }
    const r = ok(base({ kind, target, minR: R('1000'), maxR: R('100000'), check: 'nominal', precision: pct('50') }));
    const got = r.solutions[0].nominal.sub(target).abs();
    expect(got.eq(best!)).toBe(true);
  });
});

describe('no solution', () => {
  it('says so, shows the closest and suggests what works', () => {
    const r = ok(base({ target: R('1060'), precision: pct('0.5'), check: 'nominal' }));
    expect(r.message).toBe('Aucune solution en E24 à ±0.5 %');
    expect(r.solutions.every((s) => !s.pass)).toBe(true);
    expect(r.best!.positions[0].value.eq(R('1100'))).toBe(true);
    expect(r.suggestions.some((s) => s.startsWith('Série plus fine : E192'))).toBe(true);
    expect(r.suggestions.some((s) => s.startsWith('Combinaisons'))).toBe(true);
  });

  it('suggests a better tolerance when only the tolerance is in the way', () => {
    const r = ok(base({ target: R('4700'), precision: pct('0.5') }));
    expect(r.message).toBe('Aucune solution en E24 à ±0.5 %');
    expect(r.suggestions).toContain('Meilleure tolérance : des composants à 0.5 % en E24 conviennent.');
  });

  it('pairs solve what single values cannot', () => {
    const r = ok(base({ target: R('1060'), precision: pct('0.5'), check: 'nominal', combos: true }));
    expect(r.solutions[0].pass).toBe(true);
    expect(r.solutions[0].parts).toBe(2);
    expect(Math.abs(r.solutions[0].nominalErr)).toBeLessThanOrEqual(0.005);
  });

  it('flags a target outside the allowed range', () => {
    const r = ok(base({ target: R('2e9'), maxR: R('1e9'), check: 'nominal' }));
    expect(r.best!.positions[0].value.eq(R('1e9'))).toBe(true);
    expect(r.suggestions.some((s) => s.includes('en bord de plage'))).toBe(true);
  });
});

describe('extreme decades', () => {
  it('finds milliohm and gigaohm values', () => {
    expect(ok(base({ target: R('0.0015'), minR: R('0.001') })).solutions[0].positions[0].value.eq(R('0.0015'))).toBe(true);
    expect(ok(base({ target: R('8.2e8'), maxR: R('1e9') })).solutions[0].positions[0].value.eq(R('8.2e8'))).toBe(true);
  });
});

describe('limits', () => {
  it('max current keeps R1 + R2 >= Vin / Imax', () => {
    const r = ok(base({ kind: 'divider', target: R('0.66'), voltage: R('5'), maxCurrent: R('100e-6') }));
    expect(r.solutions.length).toBeGreaterThan(0);
    for (const s of r.solutions) expect(s.current!).toBeLessThanOrEqual(100e-6);
  });

  it('max power is per physical resistor', () => {
    const r = ok(base({ target: R('100'), voltage: R('5'), maxPower: R('0.125'), combos: true, check: 'nominal' }));
    // A single 100 Ω part takes 250 mW: only pairs that share the load remain.
    for (const s of r.solutions) expect(s.maxPartPower!).toBeLessThanOrEqual(0.125);
    expect(r.solutions[0].parts).toBe(2);
  });
});

describe('invalid input gives clear messages', () => {
  it.each<[Partial<SolveInput>, RegExp]>([
    [{ kind: 'divider', target: R('1.2') }, /entre 0 et 1/],
    [{ kind: 'gain', target: R('0.9') }, /supérieur à 1/],
    [{ kind: 'ratio', target: R('0') }, /supérieure à 0/],
    [{ target: R('-5') }, /supérieure à 0/],
    [{ minR: R('1e6'), maxR: R('10') }, /dépasse la maximale/],
    [{ maxCurrent: R('0.001') }, /nécessitent la tension/],
    [{ minR: R('2e9'), maxR: R('3e9') }, /recouper/],
    [{ series: 'E12', minR: R('1.3'), maxR: R('1.4') }, /Aucune valeur E12/],
  ])('%#', (over, msg) => {
    const r = solve(base(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});

describe('performance', () => {
  it('E192 divider with pairs, 10 Ω–1 MΩ, finishes in a few seconds', () => {
    const t0 = performance.now();
    const r = ok(base({ kind: 'divider', series: 'E192', target: R('0.123456'), combos: true, precision: pct('0.01'), check: 'nominal' }));
    const ms = performance.now() - t0;
    console.log(`E192 + pairs: ${ms.toFixed(0)} ms`);
    expect(r.solutions[0].pass).toBe(true);
    expect(ms).toBeLessThan(8000);
  });
});
