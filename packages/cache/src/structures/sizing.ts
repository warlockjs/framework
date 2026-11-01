import { CacheConfigurationError } from "../types";

/**
 * Bloom filter geometry for `expectedItems` at `errorRate`: the number of bits
 * and the number of hash functions that minimise memory for that error rate.
 *
 * One million items at 1% need about 9.6 million bits (1.2 MB) and 7 hashes;
 * at 0.1% about 14.4 million bits (1.8 MB) and 10 hashes.
 */
export function bloomGeometry(
  expectedItems: number,
  errorRate: number,
): { bits: number; hashes: number } {
  assertPositiveInteger("expectedItems", expectedItems);

  if (!(errorRate > 0 && errorRate < 1)) {
    throw new CacheConfigurationError(
      `Invalid errorRate: ${errorRate}. Expected a number between 0 and 1 (exclusive), e.g. 0.01.`,
    );
  }

  const bits = Math.ceil((-expectedItems * Math.log(errorRate)) / Math.LN2 ** 2);
  const hashes = Math.max(1, Math.round((bits / expectedItems) * Math.LN2));

  return { bits, hashes };
}

export function assertPositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CacheConfigurationError(`Invalid ${name}: ${value}. Expected a positive integer.`);
  }
}
