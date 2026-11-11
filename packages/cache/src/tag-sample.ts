/**
 * Up to `count` members starting at a random offset (all of them when there
 * are fewer), so repeated samples cover a large index over time.
 *
 * @internal
 */
export function sampleMembers(members: readonly string[], count: number): string[] {
  if (members.length <= count) {
    return [...members];
  }

  const start = Math.floor(Math.random() * members.length);

  return Array.from({ length: count }, (_, index) => members[(start + index) % members.length]!);
}
