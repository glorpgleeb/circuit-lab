// A set of equations "name = expression", one per line, in any order.
// Builds the dependency graph, finds the evaluation order, detects cycles,
// then evaluates with unit inference and clear per-line errors.
import { parseSI } from '../units/si';
import { eqDims, parseUnit, unitName, type Dims, type Unit } from '../units/dims';
import { EqError, FUNCTION_NAMES, evaluate, inferDims, parseExpr, symbols, type Expr } from './expr';

export interface Equation {
  line: number; // 1-based line in the source text
  lhs: string;
  rhs: Expr;
  deps: string[]; // variables used on the right side
}
export interface LineError {
  line: number;
  message: string;
}
export interface EqSystem {
  equations: Equation[]; // valid equations, source order
  order: Equation[]; // evaluation order (cycle members excluded)
  inputs: string[]; // variables to be entered, order of first appearance
  computed: string[]; // variables defined by an equation, evaluation order
  cycles: Map<string, string>; // variable -> cycle description
  errors: LineError[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseSystem(text: string): EqSystem {
  const equations: Equation[] = [];
  const errors: LineError[] = [];
  const definedAt = new Map<string, number>();

  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const src = raw.replace(/#.*$/, '').trim(); // "#" starts a comment
    if (!src) return;
    const parts = src.split('=');
    if (parts.length !== 2) {
      errors.push({ line, message: parts.length < 2 ? '"=" manquant : écrivez "nom = expression"' : 'Un seul "=" par ligne' });
      return;
    }
    const lhs = parts[0].trim();
    if (!IDENT.test(lhs) || FUNCTION_NAMES.includes(lhs) || lhs === 'pi' || lhs === 'e') {
      errors.push({ line, message: `Le membre de gauche doit être un seul nom de variable (reçu "${lhs}")` });
      return;
    }
    if (definedAt.has(lhs)) {
      errors.push({ line, message: `${lhs} est déjà défini ligne ${definedAt.get(lhs)}` });
      return;
    }
    try {
      const rhs = parseExpr(parts[1]);
      definedAt.set(lhs, line);
      equations.push({ line, lhs, rhs, deps: symbols(rhs) });
    } catch (e) {
      errors.push({ line, message: e instanceof EqError ? e.message : String(e) });
    }
  });

  // Topological order by depth-first search; a back edge is a cycle.
  const byName = new Map(equations.map((e) => [e.lhs, e]));
  const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = done
  const path: string[] = [];
  const order: Equation[] = [];
  const cycles = new Map<string, string>();
  const visit = (name: string) => {
    state.set(name, 1);
    path.push(name);
    for (const d of byName.get(name)!.deps) {
      if (!byName.has(d)) continue;
      if (state.get(d) === 1) {
        const loop = [...path.slice(path.indexOf(d)), d];
        const msg = `Dépendance circulaire : ${loop.join(' → ')}`;
        loop.forEach((v) => cycles.has(v) || cycles.set(v, msg));
        if (!errors.some((e) => e.message === msg)) errors.push({ line: byName.get(d)!.line, message: msg });
      } else if (!state.has(d)) visit(d);
    }
    path.pop();
    state.set(name, 2);
    order.push(byName.get(name)!);
  };
  equations.forEach((e) => state.has(e.lhs) || visit(e.lhs));

  const inputs: string[] = [];
  for (const e of equations) for (const d of e.deps) if (!byName.has(d) && !inputs.includes(d)) inputs.push(d);
  const evalOrder = order.filter((e) => !cycles.has(e.lhs));
  errors.sort((a, b) => a.line - b.line);
  return { equations, order: evalOrder, inputs, computed: evalOrder.map((e) => e.lhs), cycles, errors };
}

// ---------- inputs ----------

export interface InputValue {
  value?: number; // SI base units
  unit: Unit | null; // null = not specified
  error?: string;
  warning?: string;
}

/**
 * Read a value field ("4.7k", "100n", "2.2uH") and a unit field ("H", "mA", "V/us").
 * A unit typed in the value is used when the unit field is empty.
 */
export function readInput(valueText: string, unitText: string): InputValue {
  const u = parseUnit(unitText);
  if (u && 'error' in u) return { unit: null, error: u.error };
  let unit = u as Unit | null;
  if (valueText.trim() === '') return { unit };
  const p = parseSI(valueText);
  if ('error' in p) return { unit, error: p.error };
  let warning: string | undefined;
  if (p.unit) {
    const vu = parseUnit(p.unit);
    if (vu && 'error' in vu) return { unit, error: vu.error };
    if (vu) {
      if (!unit) unit = vu;
      else if (!eqDims(unit.dims, vu.dims)) warning = `La valeur est en ${unitName(vu.dims)} mais le champ unité indique ${unitName(unit.dims)}`;
    }
  }
  // A value with its own unit ("100mA") is complete; otherwise the unit field's prefix applies ("100" + "mA").
  const scale = p.unit ? 1 : ((u as Unit | null)?.scale ?? 1);
  return { value: p.value.toNumber() * scale, unit, warning };
}

// ---------- evaluation ----------

export interface EqResult {
  eq: Equation;
  value?: number; // SI base units
  dims: Dims | null; // null = unknown
  error?: string;
  missing?: string[]; // inputs still empty
  warnings: string[];
}

export function evaluateSystem(
  sys: EqSystem,
  inputs: Map<string, InputValue>,
  declared: Map<string, Unit | null> = new Map(), // optional unit fields of computed variables
): Map<string, EqResult> {
  const values = new Map<string, number>();
  const dims = new Map<string, Dims | null>();
  for (const [name, inp] of inputs) {
    if (inp.value !== undefined && !inp.error) values.set(name, inp.value);
    dims.set(name, inp.unit?.dims ?? null);
  }
  const results = new Map<string, EqResult>();

  for (const eq of sys.equations) {
    const msg = sys.cycles.get(eq.lhs);
    if (msg) results.set(eq.lhs, { eq, dims: null, error: msg, warnings: [] });
  }

  for (const eq of sys.order) {
    const warnings: string[] = [];
    let d = inferDims(eq.rhs, dims, warnings);
    const decl = declared.get(eq.lhs);
    if (decl) {
      if (d && !eqDims(d, decl.dims)) {
        warnings.push(`${eq.lhs} : la formule donne ${unitName(d) || 'une valeur sans dimension'}, mais le champ unité indique ${unitName(decl.dims) || 'sans dimension'}`);
      }
      d = d ?? decl.dims;
    }
    dims.set(eq.lhs, d);

    const res: EqResult = { eq, dims: d, warnings };
    results.set(eq.lhs, res);
    // Empty inputs, including those an intermediate result is waiting for.
    const missing = [...new Set(eq.deps.flatMap((v) => (results.has(v) ? (results.get(v)!.missing ?? []) : values.has(v) ? [] : [v])))];
    const broken = eq.deps.filter((v) => results.get(v)?.error && !results.get(v)!.missing);
    if (missing.length) {
      res.missing = missing;
      res.error = `Valeur manquante pour ${missing.join(', ')}`;
    } else if (broken.length) res.error = `Dépend de ${broken.join(', ')}, qui ${broken.length > 1 ? 'sont' : 'est'} en erreur`;
    else {
      try {
        res.value = evaluate(eq.rhs, values);
        values.set(eq.lhs, res.value);
      } catch (e) {
        res.error = e instanceof EqError ? e.message : `Erreur inattendue : ${(e as Error).message}`;
      }
    }
  }
  return results;
}
