/**
 * Turn a field key into readable words for a validation message.
 *
 * Splits on underscores, hyphens, dots and camel-case boundaries, lowercases
 * the words and capitalises the first one. A key without letters (such as an
 * array index) is returned unchanged.
 *
 * @example
 * ```ts
 * humanizeAttribute("max_dumbbell_kg"); // "Max dumbbell kg"
 * humanizeAttribute("firstName"); // "First name"
 * humanizeAttribute("userID"); // "User id"
 * ```
 */
export function humanizeAttribute(attribute: string): string {
  if (!/[A-Za-z]/.test(attribute)) return attribute;

  const words = attribute
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}
