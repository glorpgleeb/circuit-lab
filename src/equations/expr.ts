// Safe expression handling. mathjs is used ONLY to parse text into a syntax tree;
// the tree is converted to our own small AST that allows numbers, variables, + - * / ^,
// parentheses and a whitelist of math functions. Evaluation walks that AST.
// There is no eval(), no mathjs evaluate(), no property access, no assignment.
import { create, parseDependencies, type MathNode } from 'mathjs';
import { DIMLESS, eqDims, isDimless, mulDims, powDims, unitName, type Dims } from '../units/dims';

const { parse } = create({ parseDependencies });

export type BinOp = '+' | '-' | '*' | '/' | '^';
export type Expr =
  | { type: 'num'; value: number; text: string }
  | { type: 'const'; name: 'pi' | 'e' }
  | { type: 'sym'; name: string }
  | { type: 'op'; op: BinOp; a: Expr; b: Expr }
  | { type: 'neg'; arg: Expr }
  | { type: 'paren'; arg: Expr }
  | { type: 'fn'; name: string; args: Expr[] };

/** A user-facing error: clear message, never a crash. */
export class EqError extends Error {}

// name -> [min args, max args, implementation]
const FUNCS: Record<string, [number, number, (...x: number[]) => number]> = {
  sqrt: [1, 1, Math.sqrt],
  cbrt: [1, 1, Math.cbrt],
  abs: [1, 1, Math.abs],
  exp: [1, 1, Math.exp],
  ln: [1, 1, Math.log],
  log: [1, 2, (x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b))],
  log10: [1, 1, Math.log10],
  log2: [1, 1, Math.log2],
  sin: [1, 1, Math.sin],
  cos: [1, 1, Math.cos],
  tan: [1, 1, Math.tan],
  asin: [1, 1, Math.asin],
  acos: [1, 1, Math.acos],
  atan: [1, 1, Math.atan],
  atan2: [2, 2, Math.atan2],
  sinh: [1, 1, Math.sinh],
  cosh: [1, 1, Math.cosh],
  tanh: [1, 1, Math.tanh],
  hypot: [2, 2, Math.hypot],
  min: [1, 8, Math.min],
  max: [1, 8, Math.max],
  floor: [1, 1, Math.floor],
  ceil: [1, 1, Math.ceil],
  round: [1, 1, Math.round],
};
export const FUNCTION_NAMES = Object.keys(FUNCS);
const CONSTS = new Set(['pi', 'e']);
const OPS: Record<string, BinOp> = { add: '+', subtract: '-', multiply: '*', divide: '/', pow: '^' };

/** Parse one expression into the restricted AST. Throws EqError with a readable message. */
export function parseExpr(text: string): Expr {
  let node: MathNode;
  try {
    node = parse(text);
  } catch (e) {
    throw new EqError(`Erreur de syntaxe : ${(e as Error).message}`);
  }
  return convert(node);
}

function convert(n: MathNode): Expr {
  // mathjs node types are a wide union; read fields loosely and check `type` first.
  const node = n as unknown as Record<string, any>;
  switch (n.type) {
    case 'ConstantNode':
      if (typeof node.value !== 'number') throw new EqError(`Seuls les nombres sont autorisés, pas ${JSON.stringify(node.value)}`);
      return { type: 'num', value: node.value, text: String(node.value) };
    case 'SymbolNode':
      if (CONSTS.has(node.name)) return { type: 'const', name: node.name };
      if (Object.hasOwn(FUNCS, node.name)) throw new EqError(`"${node.name}" est un nom de fonction, pas une variable`);
      return { type: 'sym', name: node.name };
    case 'ParenthesisNode':
      return { type: 'paren', arg: convert(node.content) };
    case 'OperatorNode': {
      if (node.fn === 'unaryMinus') return { type: 'neg', arg: convert(node.args[0]) };
      if (node.fn === 'unaryPlus') return convert(node.args[0]);
      const op = OPS[node.fn];
      if (!op || node.args.length !== 2) throw new EqError(`Opérateur "${node.op}" interdit (utilisez + - * / ^)`);
      return { type: 'op', op, a: convert(node.args[0]), b: convert(node.args[1]) };
    }
    case 'FunctionNode': {
      const name: string = node.fn?.name;
      const spec = Object.hasOwn(FUNCS, name) ? FUNCS[name] : undefined;
      if (!spec) throw new EqError(`Fonction inconnue "${name ?? '?'}". Autorisées : ${FUNCTION_NAMES.join(', ')}`);
      if (node.args.length < spec[0] || node.args.length > spec[1]) throw new EqError(`${name}() attend ${spec[0] === spec[1] ? spec[0] : `${spec[0]}–${spec[1]}`} argument(s)`);
      return { type: 'fn', name, args: node.args.map(convert) };
    }
    default:
      throw new EqError(`Interdit dans une formule : ${n.type.replace('Node', '').toLowerCase()} (${n.toString()})`);
  }
}

/** Variables used by an expression, in order of first appearance. */
export function symbols(e: Expr, out: string[] = []): string[] {
  switch (e.type) {
    case 'sym':
      if (!out.includes(e.name)) out.push(e.name);
      break;
    case 'op':
      symbols(e.a, out);
      symbols(e.b, out);
      break;
    case 'neg':
    case 'paren':
      symbols(e.arg, out);
      break;
    case 'fn':
      e.args.forEach((a) => symbols(a, out));
      break;
  }
  return out;
}

// ---------- printing ----------

export function toText(e: Expr): string {
  switch (e.type) {
    case 'num': return e.text;
    case 'const': return e.name;
    case 'sym': return e.name;
    case 'paren': return `(${toText(e.arg)})`;
    case 'neg': return `-${toText(e.arg)}`;
    case 'fn': return `${e.name}(${e.args.map(toText).join(', ')})`;
    case 'op': return e.op === '^' ? `${toText(e.a)}^${toText(e.b)}` : `${toText(e.a)} ${e.op} ${toText(e.b)}`;
  }
}

const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'Delta', 'Omega', 'Phi', 'Theta']);

/** Engineering-style variable name: Vin -> V_{in}, R_load -> R_{load}, tau -> \tau, R1 -> R_{1}. */
export function texSymbol(name: string): string {
  const word = (w: string) => (GREEK.has(w) ? `\\${w}` : w.length > 1 ? `\\mathrm{${w}}` : w);
  if (GREEK.has(name)) return `\\${name}`;
  const us = name.indexOf('_');
  if (us > 0) return `${word(name.slice(0, us))}_{${name.slice(us + 1).split('_').map(word).join(',')}}`;
  const m = /^([A-Za-z])(.+)$/.exec(name);
  if (m) {
    return `${m[1]}_{${word(m[2])}}`;
  }
  return name;
}

export function toTex(e: Expr): string {
  switch (e.type) {
    case 'num': return e.text;
    case 'const': return e.name === 'pi' ? '\\pi' : 'e';
    case 'sym': return texSymbol(e.name);
    case 'paren': return `\\left(${toTex(e.arg)}\\right)`;
    case 'neg': return `-${toTex(e.arg)}`;
    case 'fn':
      if (e.name === 'sqrt') return `\\sqrt{${toTex(e.args[0])}}`;
      if (e.name === 'abs') return `\\left|${toTex(e.args[0])}\\right|`;
      return `\\operatorname{${e.name}}\\left(${e.args.map(toTex).join(', ')}\\right)`;
    case 'op': {
      const strip = (x: Expr) => (x.type === 'paren' ? x.arg : x); // a fraction bar already groups
      if (e.op === '/') return `\\frac{${toTex(strip(e.a))}}{${toTex(strip(e.b))}}`;
      if (e.op === '^') return `{${toTex(e.a)}}^{${toTex(strip(e.b))}}`;
      if (e.op === '*') return `${toTex(e.a)} \\cdot ${toTex(e.b)}`;
      return `${toTex(e.a)} ${e.op} ${toTex(e.b)}`;
    }
  }
}

// ---------- evaluation ----------

/** Evaluate with SI-base values. Throws EqError for division by zero, √ of negatives, etc. */
export function evaluate(e: Expr, env: Map<string, number>): number {
  const v = ev(e, env);
  if (!Number.isFinite(v)) throw new EqError('Résultat non fini (dépassement)');
  return v;
}

function ev(e: Expr, env: Map<string, number>): number {
  switch (e.type) {
    case 'num': return e.value;
    case 'const': return e.name === 'pi' ? Math.PI : Math.E;
    case 'sym': {
      const v = env.get(e.name);
      if (v === undefined) throw new EqError(`${e.name} n'a pas de valeur`);
      return v;
    }
    case 'paren': return ev(e.arg, env);
    case 'neg': return -ev(e.arg, env);
    case 'op': {
      const a = ev(e.a, env);
      const b = ev(e.b, env);
      switch (e.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new EqError(`Division par zéro : ${toText(e.b)} = 0`);
          return a / b;
        case '^':
          if (a === 0 && b < 0) throw new EqError(`Division par zéro : 0 élevé à une puissance négative dans ${toText(e)}`);
          if (a < 0 && !Number.isInteger(b)) throw new EqError(`Nombre négatif élevé à une puissance fractionnaire dans ${toText(e)}`);
          return a ** b;
      }
    }
    case 'fn': {
      const x = e.args.map((a) => ev(a, env));
      const at = `${e.name}(${e.args.map(toText).join(', ')})`;
      if ((e.name === 'sqrt') && x[0] < 0) throw new EqError(`Racine carrée d'un nombre négatif : ${at} avec ${toText(e.args[0])} = ${x[0]}`);
      if (['ln', 'log', 'log10', 'log2'].includes(e.name) && x[0] <= 0) throw new EqError(`Logarithme d'un nombre ≤ 0 : ${at}`);
      if ((e.name === 'asin' || e.name === 'acos') && Math.abs(x[0]) > 1) throw new EqError(`${e.name} attend une valeur entre -1 et 1 : ${at}`);
      const r = FUNCS[e.name][2](...x);
      if (Number.isNaN(r)) throw new EqError(`Résultat indéfini : ${at}`);
      return r;
    }
  }
}

// ---------- units ----------

/** Constant value of an expression if it contains no variables, else undefined. */
function constValue(e: Expr): number | undefined {
  if (symbols(e).length) return undefined;
  try {
    return evaluate(e, new Map());
  } catch {
    return undefined;
  }
}

/**
 * Infer the dimension of an expression. `null` means unknown (a variable without unit).
 * Incompatible mixes (V + A, sin(V), ...) are reported in `warnings`.
 */
export function inferDims(e: Expr, dims: Map<string, Dims | null>, warnings: string[]): Dims | null {
  const name = (d: Dims) => unitName(d) || 'sans dimension';
  switch (e.type) {
    case 'num':
    case 'const':
      return DIMLESS;
    case 'sym':
      return dims.get(e.name) ?? null;
    case 'paren':
    case 'neg':
      return inferDims(e.arg, dims, warnings);
    case 'op': {
      const a = inferDims(e.a, dims, warnings);
      const b = inferDims(e.b, dims, warnings);
      if (e.op === '+' || e.op === '-') {
        if (a && b && !eqDims(a, b)) warnings.push(`Unités incompatibles : ${name(a)} ${e.op} ${name(b)} dans "${toText(e)}"`);
        return a ?? b;
      }
      if (e.op === '*' || e.op === '/') return a && b ? mulDims(a, b, e.op === '*' ? 1 : -1) : null;
      // power
      if (b && !isDimless(b)) warnings.push(`L'exposant doit être sans dimension dans "${toText(e)}"`);
      if (!a) return null;
      if (isDimless(a)) return DIMLESS;
      const k = constValue(e.b);
      if (k === undefined) {
        warnings.push(`Une grandeur avec unité ne peut être élevée qu'à une puissance constante : "${toText(e)}"`);
        return null;
      }
      return powDims(a, k);
    }
    case 'fn': {
      const args = e.args.map((x) => inferDims(x, dims, warnings));
      const a = args[0];
      switch (e.name) {
        case 'sqrt': return a && powDims(a, 1 / 2);
        case 'cbrt': return a && powDims(a, 1 / 3);
        case 'abs':
        case 'floor':
        case 'ceil':
        case 'round':
          return a;
        case 'min':
        case 'max':
        case 'hypot':
        case 'atan2': {
          const known = args.filter((x): x is Dims => !!x);
          if (known.some((x) => !eqDims(x, known[0]))) warnings.push(`Unités incompatibles dans ${e.name}() : ${known.map(name).join(', ')}`);
          return e.name === 'atan2' ? DIMLESS : (known[0] ?? null);
        }
        default:
          if (a && !isDimless(a)) warnings.push(`${e.name}() attend un argument sans dimension, reçu ${name(a)}`);
          return DIMLESS;
      }
    }
  }
}
