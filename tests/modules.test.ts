import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MODULES,
  exportModules,
  loadUserModules,
  parseModuleFile,
  saveUserModules,
  type Module,
} from '../src/equations/modules';
import { evaluateSystem, parseSystem, readInput } from '../src/equations/system';
import { parseUnit, unitName, type Unit } from '../src/units/dims';

/** Evaluate a module with its default values; returns name -> [value, unit name, warnings]. */
function run(m: Module) {
  const sys = parseSystem(m.formulas);
  expect(sys.errors).toEqual([]);
  const inputs = new Map(sys.inputs.map((n) => [n, readInput(m.variables[n]?.value ?? '', m.variables[n]?.unit ?? '')]));
  const declared = new Map(sys.computed.map((n) => [n, parseUnit(m.variables[n]?.unit ?? '') as Unit | null]));
  const res = evaluateSystem(sys, inputs, declared);
  return Object.fromEntries([...res].map(([k, r]) => [k, { value: r.value, unit: r.dims ? unitName(r.dims) : '?', warnings: r.warnings, error: r.error }]));
}
const byId = (id: string) => BUILTIN_MODULES.find((m) => m.id === `builtin-${id}`)!;

describe('built-in modules give known values with consistent units', () => {
  it.each<[string, Record<string, [number, string]>]>([
    ['buck-inductor', { L: [7.975e-6, 'H'], D: [0.275, ''] }],
    ['voltage-divider', { Vout: [10 / 3, 'V'], Idiv: [5 / 30e3, 'A'] }],
    ['feedback-divider', { Vout: [3.328, 'V'], Ifb: [3.328 / 41.6e3, 'A'] }],
    ['ohm-power', { V: [10, 'V'], P: [0.1, 'W'] }],
    ['led-resistor', { R: [150, 'Ω'], P: [0.06, 'W'] }],
    ['rc-filter', { fc: [159.15494309189535, 'Hz'], tau: [1e-3, 's'] }],
    ['rl-filter', { fc: [15915.494309189535, 'Hz'], tau: [10e-6, 's'] }],
    ['resistors-series-parallel', { Rs: [2000, 'Ω'], Rp: [500, 'Ω'] }],
    ['capacitors-series-parallel', { Cp: [200e-9, 'F'], Cs: [50e-9, 'F'] }],
  ])('%s', (id, expected) => {
    const r = run(byId(id));
    for (const [name, [value, unit]] of Object.entries(expected)) {
      expect(r[name].error).toBeUndefined();
      expect(r[name].value! / value).toBeCloseTo(1, 12);
      expect(r[name].unit).toBe(unit);
      expect(r[name].warnings).toEqual([]);
    }
  });

  it('covers every built-in', () => expect(BUILTIN_MODULES).toHaveLength(9));
});

describe('import / export', () => {
  it('round-trips all built-ins', () => {
    const { modules, errors } = parseModuleFile(exportModules(BUILTIN_MODULES));
    expect(errors).toEqual([]);
    expect(modules).toEqual(BUILTIN_MODULES.map(({ builtin: _b, ...m }) => m));
  });

  it('accepts a single module object', () => {
    const { modules } = parseModuleFile(JSON.stringify({ name: 'P', formulas: 'P = V * I' }));
    expect(modules).toEqual([{ name: 'P', description: '', tags: [], formulas: 'P = V * I', variables: {} }]);
  });

  it.each([
    ['not json', "Ce n'est pas un fichier JSON"],
    ['{"a":1}', "Ce n'est pas un fichier de modules Circuit Lab"],
    ['{"format":"circuit-lab-modules","version":2,"modules":[]}', 'Version de fichier non prise en charge : 2'],
  ])('rejects %s', (text, msg) => expect(parseModuleFile(text).errors).toEqual([msg]));

  it('keeps valid modules and reports each invalid one', () => {
    const file = {
      format: 'circuit-lab-modules',
      version: 1,
      modules: [
        { name: 'ok', formulas: 'y = 2 * x' },
        { name: 'evil', formulas: 'y = import("fs")' },
        { name: 'x'.repeat(101), formulas: 'y = x' },
        { name: 'link', formulas: 'y = x', resistorLinks: [{ mode: 'magic', resistors: [], fields: {} }] },
        { name: 'nolink', formulas: 'y = x', resistorLinks: [{ mode: 'single', resistors: ['y'], fields: { rt: 'nope' } }] },
      ],
    };
    const { modules, errors } = parseModuleFile(JSON.stringify(file));
    expect(modules.map((m) => m.name)).toEqual(['ok']);
    expect(errors).toEqual([
      'Module "evil": formulas, ligne 1: Fonction inconnue "import". Autorisées : sqrt, cbrt, abs, exp, ln, log, log10, log2, sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh, hypot, min, max, floor, ceil, round',
      `Module "${'x'.repeat(40)}": name dépasse 100 caractères`,
      'Module "link": resistorLinks[0].mode doit valoir divider, feedback, ratio, single',
      'Module "nolink": resistorLinks[0].fields.rt doit nommer une variable du module',
    ]);
  });

  it('a "__proto__" variable cannot pollute prototypes', () => {
    const text = '{"name":"p","formulas":"y = x","variables":{"__proto__":{"value":"1","unit":"V"}}}';
    const { modules } = parseModuleFile(text);
    expect(({} as Record<string, unknown>).value).toBeUndefined();
    expect(Object.getPrototypeOf(modules[0].variables)).toBe(Object.prototype);
    expect(Object.hasOwn(modules[0].variables, '__proto__')).toBe(true);
  });
});

describe('browser storage', () => {
  const fakeStorage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as Storage;
  };

  it('saves and loads user modules with their ids', () => {
    const s = fakeStorage();
    const mine: Module = { ...BUILTIN_MODULES[0], id: 'user-abc', builtin: undefined, name: 'My buck' };
    delete mine.builtin;
    expect(saveUserModules([mine], s)).toBeUndefined();
    expect(loadUserModules(s)).toEqual({ modules: [mine], error: undefined });
  });

  it('reports blocked or full storage instead of crashing', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    expect(loadUserModules(broken).error).toMatch(/bloqué/);
    expect(saveUserModules([], broken)).toMatch(/plein ou bloqué/);
  });
});
