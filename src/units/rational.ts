// Exact rational numbers on BigInt. Used wherever a comparison must not suffer
// floating-point rounding (E-series values, precision limits, tolerance corners).

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

export class Rational {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new RangeError('Division par zéro');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n < 0n ? -n : n, d);
    this.n = g > 1n ? n / g : n;
    this.d = g > 1n ? d / g : d;
  }

  static readonly ZERO = new Rational(0n);
  static readonly ONE = new Rational(1n);

  static int(k: number | bigint): Rational {
    return new Rational(BigInt(k));
  }

  /** m × 10^e, exactly. */
  static scaled(m: number | bigint, e: number): Rational {
    const big = BigInt(m);
    return e >= 0 ? new Rational(big * pow10(e)) : new Rational(big, pow10(-e));
  }

  /** Parse a plain decimal string ("3.3", "-0.5", "1e-3") exactly. Returns null if malformed. */
  static parseDecimal(s: string): Rational | null {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s.trim());
    if (!m) return null;
    const [, sign, int = '', frac = '', exp = '0'] = m;
    if (int.length + frac.length === 0) return null;
    const digits = BigInt((int || '0') + frac) * (sign === '-' ? -1n : 1n);
    return Rational.scaled(digits, Number(exp) - frac.length);
  }

  add(o: Rational): Rational {
    return new Rational(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Rational): Rational {
    return new Rational(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Rational): Rational {
    return new Rational(this.n * o.n, this.d * o.d);
  }
  div(o: Rational): Rational {
    return new Rational(this.n * o.d, this.d * o.n); // throws RangeError on zero divisor
  }
  abs(): Rational {
    return this.n < 0n ? new Rational(-this.n, this.d) : this;
  }
  sign(): number {
    return this.n > 0n ? 1 : this.n < 0n ? -1 : 0;
  }
  cmp(o: Rational): number {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  lt(o: Rational): boolean {
    return this.cmp(o) < 0;
  }
  le(o: Rational): boolean {
    return this.cmp(o) <= 0;
  }
  eq(o: Rational): boolean {
    return this.n === o.n && this.d === o.d;
  }
  /** For display only. Fine for this domain (values well inside double range). */
  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }
  toString(): string {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }
}
