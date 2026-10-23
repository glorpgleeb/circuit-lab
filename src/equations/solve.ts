// Solve an equation set for any input variable.
//
// The chosen target (a computed variable whose value the user gives) is expanded into
// one expression of the unknown, with intermediate variables substituted.
// 1. Symbolic: if the unknown appears exactly once, the expression is inverted step by
//    step (x + b = y  ->  x = y - b, ...). Even powers and abs() give ± branches.
// 2. Numeric otherwise: scan x over ±[1e-15, 1e15] (log-spaced) and 0, bracket sign changes,
//    refine by bisection; tangent (double) roots are found by minimising |f(x) - y|.
// Every candidate is checked by plugging it back into the original formulas.
import { EqError, evaluate, symbols, toText, type BinOp, type Expr } from './expr';
import { evaluateSystem, type EqSystem, type InputValue } from './system';

// ---------- building expressions with correct parentheses ----------

const PREC: Record<BinOp, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
const prec = (e: Expr) => (e.type === 'op' ? PREC[e.op] : e.type === 'neg' ? 3 : 9);
const wrap = (e: Expr): Expr => ({ type: 'paren', arg: e });

function op(o: BinOp, a: Expr, b: Expr): Expr {
  // (p / q) / b  ->  p / (q * b): reads better than a chain of divisions
  const ua = a.type === 'paren' ? a.arg : a;
  if (o === '/' && ua.type === 'op' && ua.op === '/') return op('/', ua.a, op('*', ua.b, b));
  const p = PREC[o];
  const left = o === '^' ? prec(a) <= 4 : prec(a) < p;
  const right = o === '^' ? prec(b) < 9 : o === '-' || o === '/' ? prec(b) <= p : prec(b) < p;
  return { type: 'op', op: o, a: left ? wrap(a) : a, b: right ? wrap(b) : b };
}
const num = (v: number): Expr => ({ type: 'num', value: v, text: String(v) });
const neg = (e: Expr): Expr => ({ type: 'neg', arg: prec(e) <= 3 ? wrap(e) : e });
const fn = (name: string, ...args: Expr[]): Expr => ({ type: 'fn', name, args });

/** Replace computed variables for which `expand` is true by their formulas, recursively. */
export function inline(sys: EqSystem, name: string, expand: (v: string) => boolean = () => true): Expr {
  const eq = sys.equations.find((e) => e.lhs === name);
  if (!eq) throw new EqError(`${name} n'est défini par aucune équation`);
  const sub = (e: Expr): Expr => {
    switch (e.type) {
      case 'sym': {
        const def = sys.equations.find((d) => d.lhs === e.name);
        return def && expand(e.name) ? wrap(sub(def.rhs)) : e;
      }
      case 'op': return { ...e, a: sub(e.a), b: sub(e.b) };
      case 'neg':
      case 'paren': return { ...e, arg: sub(e.arg) };
      case 'fn': return { ...e, args: e.args.map(sub) };
      default: return e;
    }
  };
  return sub(eq.rhs);
}

const count = (e: Expr, x: string): number => {
  switch (e.type) {
    case 'sym': return e.name === x ? 1 : 0;
    case 'op': return count(e.a, x) + count(e.b, x);
    case 'neg':
    case 'paren': return count(e.arg, x);
    case 'fn': return e.args.reduce((n, a) => n + count(a, x), 0);
    default: return 0;
  }
};

const unparen = (e: Expr): Expr => (e.type === 'paren' ? unparen(e.arg) : e);

export interface Branches {
  exprs: Expr[];
  notes: string[];
}

/**
 * Solve `f = y` for x, where x appears exactly once in f.
 * Returns null when a step cannot be inverted (min, max, floor, …).
 */
export function invert(f: Expr, x: string, y: Expr): Branches | null {
  const notes: string[] = [];
  let branches: { side: Expr; rhs: Expr }[] = [{ side: f, rhs: y }];
  for (let guard = 0; guard < 200; guard++) {
    const next: { side: Expr; rhs: Expr }[] = [];
    let done = true;
    for (const { side, rhs } of branches) {
      const s = unparen(side);
      if (s.type === 'sym' && s.name === x) {
        next.push({ side: s, rhs });
        continue;
      }
      done = false;
      const step = invertStep(s, x, rhs, notes);
      if (!step) return null;
      next.push(...step);
    }
    branches = next;
    if (done) return { exprs: branches.map((b) => unparen(b.rhs)), notes };
  }
  return null;
}

function invertStep(s: Expr, x: string, y: Expr, notes: string[]): { side: Expr; rhs: Expr }[] | null {
  switch (s.type) {
    case 'neg':
      return [{ side: s.arg, rhs: neg(y) }];
    case 'op': {
      const inA = count(s.a, x) > 0;
      const { a, b } = s;
      switch (s.op) {
        case '+': return [inA ? { side: a, rhs: op('-', y, b) } : { side: b, rhs: op('-', y, a) }];
        case '-': return [inA ? { side: a, rhs: op('+', y, b) } : { side: b, rhs: op('-', a, y) }];
        case '*': return [inA ? { side: a, rhs: op('/', y, b) } : { side: b, rhs: op('/', y, a) }];
        case '/': return [inA ? { side: a, rhs: op('*', y, b) } : { side: b, rhs: op('/', a, y) }];
        case '^': {
          if (!inA) return [{ side: b, rhs: op('/', fn('ln', y), fn('ln', a)) }];
          const root = op('^', y, op('/', num(1), b));
          const k = constant(b);
          // x^k = y with an even integer k has two real roots ±y^(1/k)
          if (k !== undefined && Number.isInteger(k) && k % 2 === 0) return [{ side: a, rhs: root }, { side: a, rhs: neg(root) }];
          if (k !== undefined && Number.isInteger(k) && k % 2 !== 0) {
            notes.push("Puissance entière impaire inversée pour y ≥ 0 seulement (la racine impaire réelle d'une valeur négative n'est pas calculée).");
          }
          return [{ side: a, rhs: root }];
        }
      }
      return null;
    }
    case 'fn': {
      const a = s.args[0];
      const periodic = (name: string) =>
        notes.push(`${name}() est périodique : seule la solution principale est affichée, il en existe d'autres.`);
      switch (s.name) {
        case 'sqrt': return [{ side: a, rhs: op('^', y, num(2)) }]; // y < 0 is rejected by the plug-back check
        case 'cbrt': return [{ side: a, rhs: op('^', y, num(3)) }];
        case 'exp': return [{ side: a, rhs: fn('ln', y) }];
        case 'ln': return [{ side: a, rhs: fn('exp', y) }];
        case 'log':
          if (s.args.length === 1) return [{ side: a, rhs: fn('exp', y) }];
          if (count(a, x)) return [{ side: a, rhs: op('^', s.args[1], y) }];
          return [{ side: s.args[1], rhs: op('^', a, op('/', num(1), y)) }];
        case 'log10': return [{ side: a, rhs: op('^', num(10), y) }];
        case 'log2': return [{ side: a, rhs: op('^', num(2), y) }];
        case 'abs': return [{ side: a, rhs: y }, { side: a, rhs: neg(y) }];
        case 'sin': periodic('sin'); return [{ side: a, rhs: fn('asin', y) }];
        case 'cos': periodic('cos'); return [{ side: a, rhs: fn('acos', y) }];
        case 'tan': periodic('tan'); return [{ side: a, rhs: fn('atan', y) }];
        case 'asin': return [{ side: a, rhs: fn('sin', y) }];
        case 'acos': return [{ side: a, rhs: fn('cos', y) }];
        case 'atan': return [{ side: a, rhs: fn('tan', y) }];
        case 'sinh': return [{ side: a, rhs: fn('ln', op('+', y, fn('sqrt', op('+', op('^', y, num(2)), num(1))))) }];
        case 'tanh': return [{ side: a, rhs: op('*', num(0.5), fn('ln', op('/', op('+', num(1), y), op('-', num(1), y)))) }];
      }
      return null;
    }
  }
  return null;
}

function constant(e: Expr): number | undefined {
  if (symbols(e).length) return undefined;
  try {
    return evaluate(e, new Map());
  } catch {
    return undefined;
  }
}

// ---------- numeric ----------

export const SEARCH_MIN = 1e-15;
export const SEARCH_MAX = 1e15;
const PER_DECADE = 24;

/** All real roots of h(x) = 0 in ±[1e-15, 1e15] and 0. `h` returns NaN where undefined. */
export function findRoots(h: (x: number) => number): number[] {
  const xs: number[] = [];
  const decades = Math.log10(SEARCH_MAX / SEARCH_MIN);
  for (let i = decades * PER_DECADE; i >= 0; i--) xs.push(-SEARCH_MIN * 10 ** (i / PER_DECADE));
  xs.push(0);
  for (let i = 0; i <= decades * PER_DECADE; i++) xs.push(SEARCH_MIN * 10 ** (i / PER_DECADE));
  const hs = xs.map(h);
  const roots: number[] = [];
  const ok = (v: number) => Number.isFinite(v);

  for (let i = 0; i < xs.length; i++) {
    if (hs[i] === 0) roots.push(xs[i]);
    if (i + 1 < xs.length && ok(hs[i]) && ok(hs[i + 1]) && hs[i] * hs[i + 1] < 0) {
      const r = bisect(h, xs[i], xs[i + 1], hs[i]);
      // A sign change across a pole is not a root: |h| there is not small.
      if (r !== undefined && Math.abs(h(r)) <= 1e-6 * Math.min(Math.abs(hs[i]), Math.abs(hs[i + 1]))) roots.push(r);
    }
    // Tangent root: |h| has a local minimum without a sign change.
    if (i > 0 && i + 1 < xs.length && [hs[i - 1], hs[i], hs[i + 1]].every(ok) &&
      Math.sign(hs[i - 1]) === Math.sign(hs[i]) && Math.sign(hs[i]) === Math.sign(hs[i + 1]) &&
      Math.abs(hs[i]) < Math.abs(hs[i - 1]) && Math.abs(hs[i]) < Math.abs(hs[i + 1])) {
      const r = goldenMin((x) => Math.abs(h(x)), xs[i - 1], xs[i + 1]);
      const scale = Math.max(Math.abs(hs[i - 1]), Math.abs(hs[i + 1]));
      if (Math.abs(h(r)) <= 1e-9 * scale) roots.push(r);
    }
  }
  roots.sort((a, b) => a - b);
  return roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]) > 1e-7 * Math.max(Math.abs(r), Math.abs(roots[i - 1]), 1e-300));
}

function bisect(h: (x: number) => number, a: number, b: number, ha: number): number | undefined {
  for (let i = 0; i < 300; i++) {
    const m = a + (b - a) / 2;
    if (m === a || m === b) return m;
    const hm = h(m);
    if (!Number.isFinite(hm)) return undefined;
    if (hm === 0) return m;
    if (Math.sign(hm) === Math.sign(ha)) {
      a = m;
      ha = hm;
    } else b = m;
  }
  return a + (b - a) / 2;
}

function goldenMin(f: (x: number) => number, a: number, b: number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  for (let i = 0; i < 200 && Math.abs(b - a) > 1e-15 * Math.abs(c); i++) {
    if (f(c) < f(d)) b = d;
    else a = c;
    c = b - g * (b - a);
    d = a + g * (b - a);
  }
  return (a + b) / 2;
}

// ---------- public API ----------

export type SolveOutcome =
  | {
      ok: true;
      method: 'symbolic' | 'numeric';
      exprs: Expr[]; // symbolic solution formulas (one per branch)
      solutions: number[];
      message: string;
      notes: string[];
    }
  | { ok: false; error: string };

/**
 * Solve for input `unknown`, given the value of computed variable `target`.
 * `inputs` holds the other inputs (SI base values).
 */
export function solveFor(
  sys: EqSystem,
  unknown: string,
  target: string,
  inputs: Map<string, InputValue>,
  given: InputValue,
): SolveOutcome {
  if (sys.cycles.size) return { ok: false, error: "Corrigez d'abord la dépendance circulaire." };
  if (!sys.computed.includes(target)) return { ok: false, error: `${target} n'est pas une variable calculée` };
  if (given.error) return { ok: false, error: `${target}: ${given.error}` };
  if (given.value === undefined) return { ok: false, error: `Valeur manquante pour ${target}` };

  // Intermediates that do not depend on the unknown stay as symbols (e.g. D) with their computed value.
  const free = evaluateSystem(sys, new Map([...inputs].filter(([k]) => k !== unknown)));
  const dependsOnX = (v: string) => count(inline(sys, v), unknown) > 0;
  const f = inline(sys, target, dependsOnX);
  const n = count(f, unknown);
  if (n === 0) return { ok: false, error: `${unknown} n'influe pas sur ${target}` };

  const env = new Map<string, number>();
  const missing: string[] = [];
  for (const v of symbols(f)) {
    if (v === unknown) continue;
    const r = free.get(v);
    if (r) {
      if (r.missing) missing.push(...r.missing.filter((m) => !missing.includes(m)));
      else if (r.error) return { ok: false, error: `${v}: ${r.error}` };
      else env.set(v, r.value!);
      continue;
    }
    const inp = inputs.get(v);
    if (inp?.error) return { ok: false, error: `${v}: ${inp.error}` };
    if (inp?.value === undefined) missing.includes(v) || missing.push(v);
    else env.set(v, inp.value);
  }
  if (missing.length) return { ok: false, error: `Valeur manquante pour ${missing.join(', ')}` };
  const y = given.value;
  env.set(target, y);

  const g = (x: number) => {
    try {
      return evaluate(f, new Map(env).set(unknown, x));
    } catch {
      return NaN;
    }
  };
  // Plug back in: the solution must reproduce the given target value.
  const checks = (x: number) => {
    const v = g(x);
    return Number.isFinite(v) && Math.abs(v - y) <= 1e-9 * Math.max(Math.abs(y), Math.abs(v)) + 1e-300;
  };
  const describe = (count: number, extra = '') =>
    count === 0 ? `Aucune solution réelle pour ${unknown}${extra}.` : count === 1 ? `1 solution.` : `${count} solutions.`;

  if (n === 1) {
    const inv = invert(f, unknown, { type: 'sym', name: target });
    if (inv) {
      const solutions: number[] = [];
      const exprs: Expr[] = [];
      const notes = [...inv.notes];
      for (const e of inv.exprs) {
        try {
          const v = evaluate(e, env);
          if (checks(v) && !solutions.some((s) => Math.abs(s - v) <= 1e-12 * Math.abs(v))) {
            solutions.push(v);
            exprs.push(e);
          } else if (!checks(v)) notes.push(`Branche ${unknown} = ${toText(e)} : donne ${v}, qui ne vérifie pas l'équation.`);
        } catch (err) {
          notes.push(`Branche ${unknown} = ${toText(e)} : ${(err as Error).message}`);
        }
      }
      return { ok: true, method: 'symbolic', exprs, solutions, message: describe(solutions.length), notes };
    }
  }

  const roots = findRoots((x) => g(x) - y).filter(checks);
  const notes = [
    n > 1 ? `${unknown} apparaît ${n} fois dans la formule de ${target} : résolution numérique.` : `Cette formule ne peut pas être inversée symboliquement : résolution numérique.`,
    `${unknown} cherché dans ±[1e-15, 1e15] et 0.`,
  ];
  return { ok: true, method: 'numeric', exprs: [], solutions: roots, message: describe(roots.length, ' dans la plage explorée'), notes };
}
