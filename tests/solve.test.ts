import { describe, expect, it } from 'vitest';
import { toText } from '../src/equations/expr';
import { solveFor } from '../src/equations/solve';
import { parseSystem, readInput, type InputValue } from '../src/equations/system';

const BUCK = `L = ((Vin - Vout) * D) / (0.3 * Ioutmax * fsw)
D = Vout / Vin`;

function solve(text: string, unknown: string, target: string, given: string, vals: Record<string, string>) {
  const sys = parseSystem(text);
  const inputs = new Map<string, InputValue>(Object.entries(vals).map(([k, v]) => [k, readInput(v, '')]));
  return solveFor(sys, unknown, target, inputs, readInput(given, ''));
}
const ok = (r: ReturnType<typeof solve>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('symbolic', () => {
  it('buck: fsw from L', () => {
    const r = ok(solve(BUCK, 'fsw', 'L', '7.975u', { Vin: '12', Vout: '3.3', Ioutmax: '2' }));
    expect(r.method).toBe('symbolic');
    expect(r.solutions).toHaveLength(1);
    expect(r.solutions[0]).toBeCloseTo(500e3, 6);
    expect(toText(r.exprs[0])).toBe('((Vin - Vout) * D) / (L * 0.3 * Ioutmax)'); // D stays a symbol: it does not depend on fsw
  });

  it('buck: Ioutmax from L', () => {
    const r = ok(solve(BUCK, 'Ioutmax', 'L', '7.975u', { Vin: '12', Vout: '3.3', fsw: '500k' }));
    expect(r.solutions[0]).toBeCloseTo(2, 12);
  });

  it('RC cutoff: R from fc', () => {
    const r = ok(solve('fc = 1 / (2 * pi * R * C)', 'R', 'fc', '159.154943', { C: '100n' }));
    expect(r.method).toBe('symbolic');
    expect(r.solutions[0]).toBeCloseTo(10e3, 3);
  });

  it('even power gives two solutions', () => {
    const r = ok(solve('y = x^2', 'x', 'y', '4', {}));
    expect(r.solutions.sort((a, b) => a - b)).toEqual([-2, 2]);
    expect(r.message).toBe('2 solutions.');
  });

  it('no solution is stated, with the reason', () => {
    const r = ok(solve('y = sqrt(x)', 'x', 'y', '-1', {}));
    expect(r.solutions).toEqual([]);
    expect(r.message).toBe('Aucune solution réelle pour x.');
    expect(r.notes.join(' ')).toMatch(/ne vérifie pas/);
    const r2 = ok(solve('y = x^2 + 1', 'x', 'y', '0', {}));
    expect(r2.solutions).toEqual([]);
    expect(r2.notes.join(' ')).toMatch(/puissance fractionnaire/);
    const r3 = ok(solve('y = 1 / x', 'x', 'y', '0', {}));
    expect(r3.solutions).toEqual([]);
    expect(r3.notes.join(' ')).toMatch(/Division par zéro/);
  });

  it('periodic functions: principal solution plus a note', () => {
    const r = ok(solve('y = sin(x)', 'x', 'y', '0.5', {}));
    expect(r.solutions[0]).toBeCloseTo(Math.PI / 6, 12);
    expect(r.notes[0]).toMatch(/périodique/);
  });
});

describe('numeric', () => {
  it('buck: Vout from L has two solutions (3.3 V and 8.7 V)', () => {
    const r = ok(solve(BUCK, 'Vout', 'L', '7.975u', { Vin: '12', Ioutmax: '2', fsw: '500k' }));
    expect(r.method).toBe('numeric');
    expect(r.solutions).toHaveLength(2);
    expect(r.solutions[0]).toBeCloseTo(3.3, 9);
    expect(r.solutions[1]).toBeCloseTo(8.7, 9);
  });

  it('x·e^x = 1 (omega constant)', () => {
    const r = ok(solve('y = x * exp(x)', 'x', 'y', '1', {}));
    expect(r.solutions).toHaveLength(1);
    expect(r.solutions[0]).toBeCloseTo(0.5671432904097838, 12);
  });

  it('tangent root x + 1/x = 2 and no root for x + 1/x = 1', () => {
    const r = ok(solve('y = x + 1 / x', 'x', 'y', '2', {}));
    expect(r.solutions).toHaveLength(1);
    expect(r.solutions[0]).toBeCloseTo(1, 6);
    const none = ok(solve('y = x + 1 / x', 'x', 'y', '1', {}));
    expect(none.solutions).toEqual([]);
    expect(none.message).toBe('Aucune solution réelle pour x dans la plage explorée.');
  });

  it('a pole is not reported as a root', () => {
    const r = ok(solve('y = x / (x - 2) + x / (x - 2)', 'x', 'y', '0', {}));
    expect(r.solutions).toEqual([0]);
  });
});

describe('errors', () => {
  it.each([
    [BUCK, 'Vin', 'L', '', { Vout: '3.3', Ioutmax: '2', fsw: '500k' }, 'Valeur manquante pour L'],
    [BUCK, 'fsw', 'L', '1u', { Vin: '12', Ioutmax: '2' }, 'Valeur manquante pour Vout'],
    ['a = b\nc = d', 'd', 'a', '1', {}, "d n'influe pas sur a"],
    ['a = b + a', 'b', 'a', '1', {}, "Corrigez d'abord la dépendance circulaire."],
  ])('%#', (text, unknown, target, given, vals, msg) => {
    const r = solve(text, unknown, target, given, vals as Record<string, string>);
    expect(r).toEqual({ ok: false, error: msg });
  });
});
