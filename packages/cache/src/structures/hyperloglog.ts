import { hash64 } from "./hash";

/** Register index width: 2^14 = 16384 registers, about 12 KB, standard error 0.81%. */
export const HLL_PRECISION = 14;
export const HLL_REGISTERS = 1 << HLL_PRECISION;

const INDEX_SHIFT = 32 - HLL_PRECISION;
const HIGH_REMAINDER_BITS = INDEX_SHIFT;
const HIGH_REMAINDER_MASK = (1 << HIGH_REMAINDER_BITS) - 1;
const MAX_RANK = HIGH_REMAINDER_BITS + 32 + 1;

/**
 * HyperLogLog cardinality estimator over a 64-bit hash.
 *
 * Used by the in-process structures backend; Redis uses its native
 * `PFADD` / `PFCOUNT` instead.
 */
export class HyperLogLog {
  public readonly registers: Uint8Array;

  public constructor(registers?: Uint8Array) {
    this.registers = registers ?? new Uint8Array(HLL_REGISTERS);
  }

  /**
   * Record `item`. Returns true when the estimate may have changed (a register
   * grew), which is also how `PFADD` reports a probably-new item.
   */
  public add(item: string): boolean {
    const [high, low] = hash64(item);
    const index = high >>> INDEX_SHIFT;
    const remainder = high & HIGH_REMAINDER_MASK;
    let rank: number;

    if (remainder !== 0) {
      rank = Math.clz32(remainder) - (32 - HIGH_REMAINDER_BITS) + 1;
    } else if (low !== 0) {
      rank = HIGH_REMAINDER_BITS + Math.clz32(low) + 1;
    } else {
      rank = MAX_RANK;
    }

    if (rank > this.registers[index]!) {
      this.registers[index] = rank;

      return true;
    }

    return false;
  }

  /**
   * Fold `other` into this counter (register-wise maximum), so the result
   * counts the union of both sets.
   */
  public merge(other: HyperLogLog): this {
    for (let index = 0; index < HLL_REGISTERS; index++) {
      const value = other.registers[index]!;

      if (value > this.registers[index]!) {
        this.registers[index] = value;
      }
    }

    return this;
  }

  /**
   * Estimated number of distinct items.
   */
  public count(): number {
    let sum = 0;
    let zeros = 0;

    for (let index = 0; index < HLL_REGISTERS; index++) {
      const value = this.registers[index]!;

      sum += 2 ** -value;

      if (value === 0) {
        zeros++;
      }
    }

    const alpha = 0.7213 / (1 + 1.079 / HLL_REGISTERS);
    const estimate = (alpha * HLL_REGISTERS * HLL_REGISTERS) / sum;

    // Small range: linear counting is more accurate while many registers are empty.
    if (estimate <= 2.5 * HLL_REGISTERS && zeros > 0) {
      return Math.round(HLL_REGISTERS * Math.log(HLL_REGISTERS / zeros));
    }

    return Math.round(estimate);
  }
}
