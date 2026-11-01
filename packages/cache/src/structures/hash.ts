const encoder = new TextEncoder();

/**
 * MurmurHash3 (x86, 32-bit) over the UTF-8 bytes of `input`.
 *
 * Pure and deterministic: the same input and seed give the same hash on every
 * process, platform and release, which matters because the hashes decide where
 * an item lives in a structure stored in a shared cache.
 */
export function murmur3(input: string, seed: number): number {
  const bytes = encoder.encode(input);
  const length = bytes.length;
  const blocks = length >> 2;
  let hash = seed >>> 0;

  for (let index = 0; index < blocks; index++) {
    const offset = index << 2;
    let block =
      bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24);

    block = Math.imul(block, 0xcc9e2d51);
    block = (block << 15) | (block >>> 17);
    block = Math.imul(block, 0x1b873593);

    hash ^= block;
    hash = (hash << 13) | (hash >>> 19);
    hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
  }

  let tail = 0;
  const tailOffset = blocks << 2;

  switch (length & 3) {
    case 3:
      tail ^= bytes[tailOffset + 2]! << 16;
    // falls through
    case 2:
      tail ^= bytes[tailOffset + 1]! << 8;
    // falls through
    case 1:
      tail ^= bytes[tailOffset]!;
      tail = Math.imul(tail, 0xcc9e2d51);
      tail = (tail << 15) | (tail >>> 17);
      tail = Math.imul(tail, 0x1b873593);
      hash ^= tail;
  }

  hash ^= length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0;
}

/**
 * Two independent 32-bit hashes of `item`, for double hashing. The second one
 * is forced odd so the probe sequence never collapses onto a few slots.
 */
export function hashPair(item: string): [number, number] {
  return [murmur3(item, 0x9747b28c), (murmur3(item, 0x5bd1e995) | 1) >>> 0];
}

/**
 * The `index`-th probe position of `item` inside `size` slots (enhanced double
 * hashing, so successive positions are well spread even for small `size`).
 */
export function probe(hashes: [number, number], index: number, size: number): number {
  const [first, second] = hashes;

  return ((first + index * second + index * index) % size) >>> 0;
}

/**
 * A 64-bit hash of `item` as two unsigned 32-bit halves.
 */
export function hash64(item: string): [number, number] {
  return [murmur3(item, 0x1b873593), murmur3(item, 0x85ebca6b)];
}
