import { createHash } from "node:crypto";

/**
 * Short, stable content hash (first 16 hex characters of SHA-256). Used to
 * compare prompts and tool schemas between runs without storing the text.
 *
 * @example
 * hashText("You are a coach.") === hashText("You are a coach."); // true
 */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * JSON with object keys sorted at every depth, so two structurally equal
 * values always serialize to the same string.
 *
 * @example
 * stableJson({ b: 1, a: 2 }) === stableJson({ a: 2, b: 1 }); // true
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      );
    }

    return nested;
  });
}
