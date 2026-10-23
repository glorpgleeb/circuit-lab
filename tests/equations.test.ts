import { describe, expect, it } from 'vitest';
import { parseExpr, texSymbol, toTex } from '../src/equations/expr';
import { evaluateSystem, parseSystem, readInput, type InputValue } from '../src/equations/system';
import { parseUnit, unitName, type Unit } from '../src/units/dims';

const BUCK = `L = ((Vin - Vout) * D) / (0.3 * Ioutmax * fsw)
D = Vout / Vin`;

/** Run a system with inputs given as [value, unit] text pairs. */
function run(text: string, vals: Record<string, [string, string]>, declared: Record<string, string> = {}) {
  const sys = parseSystem(text);
  const inputs = new Map<string, InputValue>(Object.entries(vals).map(([k, [v, u]]) => [k, readInput(v, u)]));
  const decl = new Map(Object.entries(declared).map(([k, u]) => [k, parseUnit(u) as Unit]));
  return { sys, res: evaluateSystem(sys, inputs, decl) };
}

describe('parseSystem', () => {
  it('detects inputs in order of appearance and orders dependencies', () => {
    const sys = parseSystem(BUCK);
    expect(sys.errors).toEqual([]);
    expect(sys.inputs).toEqual(['Vin', 'Vout', 'Ioutmax', 'fsw']);
    expect(sys.computed).toEqual(['D', 'L']);
  });

  it('accepts lines in any order, blank lines and # comments', () => {
    const sys = parseSystem(`# buck\n\nD = Vout / Vin   # duty\nL = ((Vin - Vout) * D) / (0.3 * Ioutmax * fsw)\n`);
    expect(sys.errors).toEqual([]);
    expect(sys.computed).toEqual(['D', 'L']);
  });

  it('reports circular dependencies without crashing', () => {
    const sys = parseSystem('a = b + 1\nb = 2 * a\nc = x');
    expect(sys.errors.map((e) => e.message)).toEqual(['Dépendance circulaire : a → b → a']);
    expect(sys.computed).toEqual(['c']);
    const res = evaluateSystem(sys, new Map([['x', readInput('1', '')]]));
    expect(res.get('a')!.error).toMatch(/Dépendance circulaire/);
    expect(res.get('c')!.value).toBe(1);
  });

  it('reports self-reference, duplicates and bad left sides', () => {
    expect(parseSystem('x = x + 1').errors[0].message).toBe('Dépendance circulaire : x → x');
    expect(parseSystem('x = 1\nx = 2').errors[0]).toEqual({ line: 2, message: 'x est déjà défini ligne 1' });
    expect(parseSystem('a + b = 3').errors[0].message).toMatch(/seul nom de variable/);
    expect(parseSystem('f(x) = x').errors[0].message).toMatch(/seul nom de variable/);
    expect(parseSystem('y 3').errors[0].message).toMatch(/"=" manquant/);
  });

  it.each([
    ['x = import("fs")', /Fonction inconnue "import"/],
    ['x = a.b', /Interdit dans une formule/],
    ['x = [1, 2]', /Interdit dans une formule/],
    ['x = "hi"', /Seuls les nombres/],
    ['x = a % 3', /Opérateur "%" interdit/],
    ['x = sqrt(1, 2)', /attend 1 argument/],
    ['x = (a + ', /Erreur de syntaxe/],
    ['x = constructor(1)', /Fonction inconnue/],
  ])('rejects unsafe or invalid input: %s', (text, msg) => {
    expect(parseSystem(text).errors[0].message).toMatch(msg);
  });
});

describe('evaluation', () => {
  it('buck inductor: L = 7.975 µH and D = 0.275 with units inferred', () => {
    const { res } = run(BUCK, { Vin: ['12', 'V'], Vout: ['3.3', 'V'], Ioutmax: ['2', 'A'], fsw: ['500k', 'Hz'] });
    expect(res.get('D')!.value).toBeCloseTo(0.275, 12);
    expect(res.get('L')!.value).toBeCloseTo(7.975e-6, 15);
    expect(unitName(res.get('L')!.dims!)).toBe('H');
    expect(unitName(res.get('D')!.dims!)).toBe('');
    expect(res.get('L')!.warnings).toEqual([]);
  });

  it('division by zero gives a message, not NaN or Infinity', () => {
    const { res } = run(BUCK, { Vin: ['12', 'V'], Vout: ['3.3', 'V'], Ioutmax: ['0', 'A'], fsw: ['500k', 'Hz'] });
    expect(res.get('L')!.value).toBeUndefined();
    expect(res.get('L')!.error).toBe('Division par zéro : (0.3 * Ioutmax * fsw) = 0');
  });

  it('error in an intermediate value propagates clearly', () => {
    const { res } = run(BUCK, { Vin: ['0', 'V'], Vout: ['3.3', 'V'], Ioutmax: ['2', 'A'], fsw: ['500k', 'Hz'] });
    expect(res.get('D')!.error).toMatch(/Division par zéro/);
    expect(res.get('L')!.error).toBe('Dépend de D, qui est en erreur');
  });

  it('empty fields are listed', () => {
    const { res } = run(BUCK, { Vin: ['12', 'V'], Vout: ['', 'V'], Ioutmax: ['2', 'A'], fsw: ['', 'Hz'] });
    expect(res.get('D')!.error).toBe('Valeur manquante pour Vout');
    expect(res.get('L')!.error).toBe('Valeur manquante pour Vout, fsw'); // includes what D is waiting for
  });

  it('negative square root and log of zero give messages', () => {
    expect(run('y = sqrt(x)', { x: ['-4', ''] }).res.get('y')!.error).toMatch(/Racine carrée d'un nombre négatif/);
    expect(run('y = ln(x)', { x: ['0', ''] }).res.get('y')!.error).toMatch(/Logarithme/);
    expect(run('y = x^0.5', { x: ['-1', ''] }).res.get('y')!.error).toMatch(/puissance fractionnaire/);
  });

  it('warns on incompatible units', () => {
    const { res } = run('P = V + I', { V: ['5', 'V'], I: ['1', 'A'] });
    expect(res.get('P')!.warnings).toEqual(['Unités incompatibles : V + A dans "V + I"']);
    expect(run('y = sin(V)', { V: ['1', 'V'] }).res.get('y')!.warnings[0]).toMatch(/argument sans dimension, reçu V/);
  });

  it('warns when a declared result unit does not match the formula', () => {
    const { res } = run(BUCK, { Vin: ['12', 'V'], Vout: ['3.3', 'V'], Ioutmax: ['2', 'A'], fsw: ['500k', 'Hz'] }, { L: 'F' });
    expect(res.get('L')!.warnings[0]).toBe('L : la formule donne H, mais le champ unité indique F');
  });

  it('infers Hz for an RC cutoff and Ω for V/I', () => {
    const rc = run('fc = 1 / (2 * pi * R * C)', { R: ['10k', 'Ω'], C: ['100n', 'F'] }).res.get('fc')!;
    expect(rc.value).toBeCloseTo(159.15494, 4);
    expect(unitName(rc.dims!)).toBe('Hz');
    expect(unitName(run('R = V / I', { V: ['5', 'V'], I: ['10m', 'A'] }).res.get('R')!.dims!)).toBe('Ω');
  });
});

describe('inputs and units', () => {
  it('reads SI prefixes and units in value or unit field', () => {
    expect(readInput('4.7k', 'Ω').value).toBe(4700);
    expect(readInput('2.2uH', '')).toMatchObject({ value: 2.2e-6 });
    expect(unitName(readInput('2.2uH', '').unit!.dims)).toBe('H');
    expect(readInput('100', 'mA').value).toBeCloseTo(0.1, 15);
    expect(readInput('100mA', 'mA').value).toBeCloseTo(0.1, 15); // value unit wins, no double prefix
    expect(readInput('1M', 'Hz').value).toBe(1e6);
    expect(readInput('', 'V').value).toBeUndefined();
    expect(readInput('abc', 'V').error).toBe('Pas un nombre : "abc"');
    expect(readInput('1', 'volts').error).toBe('Unité inconnue "volts"');
    expect(readInput('5V', 'A').warning).toBe('La valeur est en V mais le champ unité indique A');
  });

  it('parses compound units', () => {
    const slew = parseUnit('V/us') as Unit;
    expect(unitName(slew.dims)).toBe('V/s');
    expect(slew.scale).toBeCloseTo(1e6, 6);
    expect(unitName((parseUnit('ohm*F') as Unit).dims)).toBe('s');
    expect(unitName((parseUnit('A^2*Ω') as Unit).dims)).toBe('W');
    expect(unitName((parseUnit('m') as Unit).dims)).toBe('m'); // metre, not milli
    expect(parseUnit('')).toBeNull();
    expect(unitName((parseUnit('V^0.5*s^-2') as Unit).dims)).toBe('kg^0.5·m·s^-3.5·A^-0.5');
    expect(parseUnit('constructor')).toEqual({ error: 'Unité inconnue "constructor"' }); // no prototype lookups
  });
});

describe('TeX', () => {
  it('typesets engineering names and fractions', () => {
    expect(texSymbol('Vin')).toBe('V_{\\mathrm{in}}');
    expect(texSymbol('R1')).toBe('R_{1}');
    expect(texSymbol('tau')).toBe('\\tau');
    expect(texSymbol('V_out')).toBe('V_{\\mathrm{out}}');
    expect(toTex(parseExpr('(a + b) / (2 * pi)'))).toBe('\\frac{a + b}{2 \\cdot \\pi}');
    expect(toTex(parseExpr('sqrt(x)^2'))).toBe('{\\sqrt{x}}^{2}');
  });
});
