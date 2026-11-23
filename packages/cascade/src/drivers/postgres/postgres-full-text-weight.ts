/** Internal to the PostgreSQL driver: not exported from the package. */

/**
 * The `setweight` letter of `column` in a full-text index: `"A"` when unset.
 * Anything but `"A"` to `"D"` (a MongoDB-style number) is refused, so the
 * index SQL never inlines another value.
 */
export function fullTextIndexWeight(
  weights: Readonly<Record<string, unknown>> | undefined,
  column: string,
): "A" | "B" | "C" | "D" {
  const weight = weights?.[column];

  if (weight === undefined) return "A";

  if (weight === "A" || weight === "B" || weight === "C" || weight === "D") return weight;

  throw new Error(
    `The full-text weight of "${column}" is ${JSON.stringify(weight)}; PostgreSQL weights are the letters "A" (ranks highest) to "D".`,
  );
}
