// Preferred-number series for resistors, from the IEC 60063 tables.
// These are the official tables, not rounded 10^(i/n) values: E24 differs from the formula
// at 2.7–4.7 and 8.2, and E192 has 920 where the formula gives 919 (see tests).
import { Rational } from '../units/rational';

export type SeriesName = 'E6' | 'E12' | 'E24' | 'E48' | 'E96' | 'E192';
export const SERIES_NAMES: SeriesName[] = ['E6', 'E12', 'E24', 'E48', 'E96', 'E192'];

// prettier-ignore
const E24 = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91];
// prettier-ignore
const E192 = [
  100, 101, 102, 104, 105, 106, 107, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 123, 124, 126,
  127, 129, 130, 132, 133, 135, 137, 138, 140, 142, 143, 145, 147, 149, 150, 152, 154, 156, 158, 160,
  162, 164, 165, 167, 169, 172, 174, 176, 178, 180, 182, 184, 187, 189, 191, 193, 196, 198, 200, 203,
  205, 208, 210, 213, 215, 218, 221, 223, 226, 229, 232, 234, 237, 240, 243, 246, 249, 252, 255, 258,
  261, 264, 267, 271, 274, 277, 280, 284, 287, 291, 294, 298, 301, 305, 309, 312, 316, 320, 324, 328,
  332, 336, 340, 344, 348, 352, 357, 361, 365, 370, 374, 379, 383, 388, 392, 397, 402, 407, 412, 417,
  422, 427, 432, 437, 442, 448, 453, 459, 464, 470, 475, 481, 487, 493, 499, 505, 511, 517, 523, 530,
  536, 542, 549, 556, 562, 569, 576, 583, 590, 597, 604, 612, 619, 626, 634, 642, 649, 657, 665, 673,
  681, 690, 698, 706, 715, 723, 732, 741, 750, 759, 768, 777, 787, 796, 806, 816, 825, 835, 845, 856,
  866, 876, 887, 898, 909, 920, 931, 942, 953, 965, 976, 988,
];

const everyOther = (a: number[]) => a.filter((_, i) => i % 2 === 0);
const E12 = everyOther(E24);
const E96 = everyOther(E192);

/** Mantissas per decade: 2 significant digits for E6–E24, 3 for E48–E192. */
export const TABLES: Record<SeriesName, number[]> = {
  E6: everyOther(E12),
  E12,
  E24,
  E48: everyOther(E96),
  E96,
  E192,
};

/** One standard resistor value: mant × 10^exp ohms. */
export interface Part {
  mant: number;
  exp: number;
  value: Rational;
  num: number; // float copy for fast search only
}

/** Hard search bounds: 1 mΩ to 1 GΩ. */
export const R_MIN = Rational.scaled(1, -3);
export const R_MAX = Rational.scaled(1, 9);

/** All values of a series between min and max (inclusive, exact), ascending. */
export function seriesValues(series: SeriesName, min: Rational, max: Rational): Part[] {
  const table = TABLES[series];
  const digits = table[0] >= 100 ? 3 : 2;
  const out: Part[] = [];
  for (let decade = -3; decade <= 9; decade++) {
    for (const mant of table) {
      const exp = decade - (digits - 1);
      const value = Rational.scaled(mant, exp);
      if (value.lt(min) || max.lt(value)) continue;
      out.push({ mant, exp, value, num: mant * 10 ** exp });
    }
  }
  return out;
}
