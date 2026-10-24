import { log } from "@warlock.js/logger";
import type { RuleTranslation } from "@warlock.js/seal";
import { environment } from "../utils/environment";

const PLACEHOLDER = /:([a-zA-Z_]+)/g;

/**
 * Placeholder names other validation message sets use for the values seal
 * exposes under a different name. Keyed by rule name; each entry maps the
 * alias to the seal attribute it reads.
 */
const PLACEHOLDER_ALIASES: Record<string, Record<string, string>> = {
  minLength: { length: "minLength" },
  maxLength: { length: "maxLength" },
  strongMinLength: { length: "minLength" },
  match: { matchingInput: "field" },
};

const warnedKeys = new Set<string>();

/** Test-only: forget which keys already produced a warning. */
export function resetUnfilledPlaceholderWarningsForTests(): void {
  warnedKeys.clear();
}

/** Seal attributes plus the alias names other message sets use for them. */
export function withPlaceholderAliases(
  ruleName: string,
  attributes: RuleTranslation["attributes"],
): RuleTranslation["attributes"] {
  const aliases = PLACEHOLDER_ALIASES[ruleName];

  if (!aliases) return attributes;

  const output = { ...attributes };

  for (const [alias, source] of Object.entries(aliases)) {
    if (!(alias in output) && source in attributes) {
      output[alias] = attributes[source];
    }
  }

  return output;
}

/** The `:placeholder` names in a message that `attributes` cannot fill. */
function unfilledPlaceholders(message: string, attributes: Record<string, unknown>): string[] {
  const names = new Set<string>();

  for (const match of message.matchAll(PLACEHOLDER)) {
    const name = match[1];

    if (name !== undefined && !(name in attributes)) names.add(name);
  }

  return [...names];
}

function warnUnfilled(key: string, message: string, names: string[]): void {
  if (environment() !== "development" || warnedKeys.has(key)) return;

  warnedKeys.add(key);

  log.warn(
    "validation",
    "placeholder",
    `Validation message for "${key}" still contains ${names
      .map((name) => `:${name}`)
      .join(", ")} after interpolation: "${message}". ` +
      "Check the translation placeholders against the rule's parameters.",
  );
}

export type TranslateSealRuleOptions = RuleTranslation & {
  /** Translation key to look up, e.g. `validation.maxLength`. */
  key: string;
  /** Translates the key with the given placeholders (the request-aware `t`). */
  translate: (key: string, placeholders: Record<string, unknown>) => string;
};

/**
 * Seal's default rule translation for Warlock. A translation is used only when
 * every `:placeholder` in it can be filled from the rule's parameters (after
 * mapping the alias names other message sets use, such as `:length` for
 * `:maxLength`). Otherwise seal's own message is used, so a message written
 * for a different library (for example the browser form defaults that share the
 * process-wide translation store) never reaches an API response with a raw
 * placeholder in it. In development, the first time a key falls back this way
 * a warning names the key.
 */
export function translateSealRule({
  rule,
  attributes,
  key,
  translate,
}: TranslateSealRuleOptions): string {
  const own = rule.errorMessage || rule.defaultErrorMessage || key;
  const aliased = withPlaceholderAliases(rule.name, attributes);
  const translation = translate(key, aliased);

  if (translation === key) return own;

  const leftover = unfilledPlaceholders(translation, aliased);

  if (leftover.length === 0) return translation;

  warnUnfilled(key, translation, leftover);

  return own;
}
