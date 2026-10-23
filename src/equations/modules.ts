// Modules: a named, reusable equation set with default values and units.
// Built-in modules live here; user modules are stored in localStorage and
// exported/imported as JSON. Imported files are untrusted: everything is validated.
import { parseSystem } from './system';

/** Which resistor-solver problem a pair of resistor variables forms. */
export type LinkMode = 'divider' | 'feedback' | 'ratio' | 'single';

/** Maps the resistor solver's fields to module variables, e.g. { vin: 'Vin', vout: 'Vout' }. */
export interface ResistorLink {
  mode: LinkMode;
  resistors: string[]; // the variables the button appears next to
  fields: Record<string, string>;
}

export interface VarDefault {
  value: string;
  unit: string;
}

export interface Module {
  id: string;
  name: string;
  description: string;
  tags: string[];
  formulas: string;
  variables: Record<string, VarDefault>;
  resistorLinks?: ResistorLink[];
  builtin?: boolean;
}

/** Solver fields each link mode needs (see the resistor solver page). */
export const LINK_FIELDS: Record<LinkMode, string[]> = {
  divider: ['vin', 'vout'],
  feedback: ['vref', 'vout'],
  ratio: ['ratio'],
  single: ['rt'],
};

const v = (value: string, unit: string): VarDefault => ({ value, unit });

export const BUILTIN_MODULES: Module[] = ([
  {
    id: 'builtin-buck-inductor',
    name: 'Inductance de convertisseur buck',
    description: 'Inductance pour 30 % d’ondulation de courant : L = (Vin − Vout)·D / (0.3·Ioutmax·fsw), avec D = Vout/Vin.',
    tags: ['alimentation', 'buck', 'inductance'],
    formulas: 'L = ((Vin - Vout) * D) / (0.3 * Ioutmax * fsw)\nD = Vout / Vin',
    variables: { Vin: v('12', 'V'), Vout: v('3.3', 'V'), Ioutmax: v('2', 'A'), fsw: v('500k', 'Hz'), L: v('', 'H'), D: v('', '') },
  },
  {
    id: 'builtin-voltage-divider',
    name: 'Diviseur de tension',
    description: 'Diviseur à vide, R1 en haut : Vout = Vin·R2/(R1 + R2), et son courant.',
    tags: ['diviseur', 'résistance'],
    formulas: 'Vout = Vin * R2 / (R1 + R2)\nIdiv = Vin / (R1 + R2)',
    variables: { Vin: v('5', 'V'), R1: v('10k', 'Ω'), R2: v('20k', 'Ω'), Vout: v('', 'V'), Idiv: v('', 'A') },
    resistorLinks: [{ mode: 'divider', resistors: ['R1', 'R2'], fields: { vin: 'Vin', vout: 'Vout' } }],
  },
  {
    id: 'builtin-feedback-divider',
    name: 'Pont de contre-réaction de régulateur',
    description: 'Sortie de régulateur ajustable : Vout = Vref·(1 + R1/R2), R1 entre Vout et FB, R2 entre FB et la masse.',
    tags: ['alimentation', 'régulateur', 'diviseur', 'résistance'],
    formulas: 'Vout = Vref * (1 + R1 / R2)\nIfb = Vout / (R1 + R2)',
    variables: { Vref: v('0.8', 'V'), R1: v('31.6k', 'Ω'), R2: v('10k', 'Ω'), Vout: v('', 'V'), Ifb: v('', 'A') },
    resistorLinks: [{ mode: 'feedback', resistors: ['R1', 'R2'], fields: { vref: 'Vref', vout: 'Vout' } }],
  },
  {
    id: 'builtin-ohm-power',
    name: "Loi d'Ohm et puissance",
    description: 'V = I·R et P = V·I.',
    tags: ['base', 'résistance', 'puissance'],
    formulas: 'V = I * R\nP = V * I',
    variables: { I: v('10m', 'A'), R: v('1k', 'Ω'), V: v('', 'V'), P: v('', 'W') },
  },
  {
    id: 'builtin-led-resistor',
    name: 'Résistance série de LED',
    description: 'R = (Vs − Vf)/I_LED et la puissance dissipée.',
    tags: ['led', 'résistance'],
    formulas: 'R = (Vs - Vf) / Iled\nP = (Vs - Vf) * Iled',
    variables: { Vs: v('5', 'V'), Vf: v('2', 'V'), Iled: v('20m', 'A'), R: v('', 'Ω'), P: v('', 'W') },
  },
  {
    id: 'builtin-rc-filter',
    name: 'Fréquence de coupure RC',
    description: 'Passe-bas/passe-haut RC du premier ordre : fc = 1/(2π·R·C), τ = R·C.',
    tags: ['filtre', 'rc'],
    formulas: 'fc = 1 / (2 * pi * R * C)\ntau = R * C',
    variables: { R: v('10k', 'Ω'), C: v('100n', 'F'), fc: v('', 'Hz'), tau: v('', 's') },
  },
  {
    id: 'builtin-rl-filter',
    name: 'Fréquence de coupure RL',
    description: 'Filtre RL du premier ordre : fc = R/(2π·L), τ = L/R.',
    tags: ['filtre', 'rl'],
    formulas: 'fc = R / (2 * pi * L)\ntau = L / R',
    variables: { R: v('1k', 'Ω'), L: v('10m', 'H'), fc: v('', 'Hz'), tau: v('', 's') },
  },
  {
    id: 'builtin-resistors-series-parallel',
    name: 'Résistances en série et en parallèle',
    description: 'Rs = R1 + R2, Rp = R1·R2/(R1 + R2).',
    tags: ['résistance', 'base'],
    formulas: 'Rs = R1 + R2\nRp = R1 * R2 / (R1 + R2)',
    variables: { R1: v('1k', 'Ω'), R2: v('1k', 'Ω'), Rs: v('', 'Ω'), Rp: v('', 'Ω') },
  },
  {
    id: 'builtin-capacitors-series-parallel',
    name: 'Condensateurs en série et en parallèle',
    description: 'Cp = C1 + C2, Cs = C1·C2/(C1 + C2).',
    tags: ['condensateur', 'base'],
    formulas: 'Cp = C1 + C2\nCs = C1 * C2 / (C1 + C2)',
    variables: { C1: v('100n', 'F'), C2: v('100n', 'F'), Cp: v('', 'F'), Cs: v('', 'F') },
  },
] as Omit<Module, 'builtin'>[]).map((m) => ({ ...m, builtin: true }));

// ---------- JSON import/export ----------

export const FILE_FORMAT = 'circuit-lab-modules';
export const FILE_VERSION = 1;
const LIMITS = { modules: 500, name: 100, description: 2000, tags: 20, tag: 40, formulas: 10000, vars: 200, field: 100 };
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function exportModules(modules: Module[]): string {
  const clean = modules.map(({ builtin: _b, ...m }) => m);
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, modules: clean }, null, 2);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number, what: string, required = true): string => {
  if (x === undefined && !required) return '';
  if (typeof x !== 'string') throw new Error(`${what} doit être du texte`);
  if (x.length > max) throw new Error(`${what} dépasse ${max} caractères`);
  return x;
};

/** Validate one module from untrusted data. Throws Error with a readable message. */
export type ParsedModule = Omit<Module, 'id'> & { id?: string };

export function validateModule(raw: unknown): ParsedModule {
  if (!isObj(raw)) throw new Error('Un module doit être un objet');
  const name = str(raw.name, LIMITS.name, 'name').trim();
  if (!name) throw new Error('name est vide');
  const description = str(raw.description, LIMITS.description, 'description', false);
  const tagsRaw = raw.tags ?? [];
  if (!Array.isArray(tagsRaw) || tagsRaw.length > LIMITS.tags) throw new Error(`tags doit être une liste d'au plus ${LIMITS.tags} éléments`);
  const tags = tagsRaw.map((t, i) => str(t, LIMITS.tag, `tag ${i + 1}`).trim()).filter(Boolean);
  const formulas = str(raw.formulas, LIMITS.formulas, 'formulas');
  const sys = parseSystem(formulas);
  if (sys.errors.length) throw new Error(`formulas, ligne ${sys.errors[0].line}: ${sys.errors[0].message}`);
  if (!sys.equations.length) throw new Error('formulas ne contient aucune équation');
  const names = new Set([...sys.inputs, ...sys.equations.map((e) => e.lhs)]);

  const varEntries: [string, VarDefault][] = [];
  const varsRaw = raw.variables ?? {};
  if (!isObj(varsRaw)) throw new Error('variables doit être un objet');
  const entries = Object.entries(varsRaw);
  if (entries.length > LIMITS.vars) throw new Error(`plus de ${LIMITS.vars} variables`);
  for (const [k, d] of entries) {
    if (!IDENT.test(k)) throw new Error(`nom de variable invalide "${k.slice(0, 40)}"`);
    if (!isObj(d)) throw new Error(`la variable ${k} doit être un objet`);
    varEntries.push([k, { value: str(d.value, LIMITS.field, `${k}.value`, false), unit: str(d.unit, LIMITS.field, `${k}.unit`, false) }]);
  }
  // fromEntries defines own properties: a "__proto__" key cannot change the prototype
  const variables: Record<string, VarDefault> = Object.fromEntries(varEntries);

  let resistorLinks: ResistorLink[] | undefined;
  if (raw.resistorLinks !== undefined) {
    if (!Array.isArray(raw.resistorLinks) || raw.resistorLinks.length > 20) throw new Error('resistorLinks doit être une liste');
    resistorLinks = raw.resistorLinks.map((l, i) => {
      if (!isObj(l)) throw new Error(`resistorLinks[${i}] doit être un objet`);
      const mode = l.mode as LinkMode;
      if (!Object.hasOwn(LINK_FIELDS, mode)) throw new Error(`resistorLinks[${i}].mode doit valoir ${Object.keys(LINK_FIELDS).join(', ')}`);
      if (!Array.isArray(l.resistors) || l.resistors.some((r) => typeof r !== 'string' || !names.has(r))) {
        throw new Error(`resistorLinks[${i}].resistors doit nommer des variables du module`);
      }
      if (!isObj(l.fields)) throw new Error(`resistorLinks[${i}].fields doit être un objet`);
      const fields: Record<string, string> = {};
      for (const f of LINK_FIELDS[mode]) {
        const target = l.fields[f];
        if (typeof target !== 'string' || !names.has(target)) throw new Error(`resistorLinks[${i}].fields.${f} doit nommer une variable du module`);
        fields[f] = target;
      }
      return { mode, resistors: l.resistors as string[], fields };
    });
  }
  const id = typeof raw.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) ? raw.id : undefined;
  return { ...(id ? { id } : {}), name, description, tags, formulas, variables, ...(resistorLinks ? { resistorLinks } : {}) };
}

/** Parse an exported file (or a single module object). Valid modules are kept; each bad one is reported. */
export function parseModuleFile(text: string): { modules: ParsedModule[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { modules: [], errors: ["Ce n'est pas un fichier JSON"] };
  }
  let list: unknown[];
  if (isObj(data) && data.format === FILE_FORMAT) {
    if (data.version !== FILE_VERSION) return { modules: [], errors: [`Version de fichier non prise en charge : ${String(data.version)}`] };
    if (!Array.isArray(data.modules)) return { modules: [], errors: ['"modules" doit être une liste'] };
    list = data.modules;
  } else if (isObj(data) && 'formulas' in data) list = [data];
  else return { modules: [], errors: ["Ce n'est pas un fichier de modules Circuit Lab"] };
  if (list.length > LIMITS.modules) return { modules: [], errors: [`Plus de ${LIMITS.modules} modules`] };

  const modules: ParsedModule[] = [];
  const errors: string[] = [];
  list.forEach((raw, i) => {
    try {
      modules.push(validateModule(raw));
    } catch (e) {
      const label = isObj(raw) && typeof raw.name === 'string' ? `"${raw.name.slice(0, 40)}"` : `#${i + 1}`;
      errors.push(`Module ${label}: ${(e as Error).message}`);
    }
  });
  return { modules, errors };
}

// ---------- browser storage ----------

const KEY = 'circuit-lab.modules';

export function loadUserModules(storage: Storage = localStorage): { modules: Module[]; error?: string } {
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return { modules: [], error: 'Stockage du navigateur bloqué : impossible de charger ou d’enregistrer les modules.' };
  }
  if (!raw) return { modules: [] };
  const { modules, errors } = parseModuleFile(raw);
  return {
    modules: modules.map((m) => ({ ...m, id: m.id ?? newId() })),
    error: errors.length ? `Certains modules enregistrés sont illisibles : ${errors.join('; ')}` : undefined,
  };
}

export function saveUserModules(modules: Module[], storage: Storage = localStorage): string | undefined {
  try {
    storage.setItem(KEY, exportModules(modules));
    return undefined;
  } catch {
    return 'Enregistrement impossible : stockage du navigateur plein ou bloqué.';
  }
}

export const newId = () => `user-${crypto.randomUUID()}`;
