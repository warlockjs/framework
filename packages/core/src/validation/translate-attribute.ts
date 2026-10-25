import { humanizeAttribute } from "@warlock.js/seal";

export type TranslateSealAttributeOptions = {
  /** The field key (or a value a rule asks to translate) to label. */
  attribute: string;
  /** The key of the field being validated. */
  key?: string;
  /** Every value of the validated payload. */
  allValues?: unknown;
  /** The configured attribute group, `undefined` when the app did not set one. */
  attributeGroup?: string;
  /** Whether a field without a label is turned into readable words. */
  humanize?: boolean;
  /** Translates the key with the given placeholders (the request-aware `t`). */
  translate: (key: string, placeholders?: Record<string, unknown>) => string;
};

/**
 * Whether `attribute` names a field of the request being validated (the field
 * itself or a sibling a rule refers to), as opposed to a value such as an enum
 * member, which is never humanised.
 */
function isFieldName(attribute: string, key: string | undefined, allValues: unknown): boolean {
  if (attribute === key) return true;

  return typeof allValues === "object" && allValues !== null && Object.hasOwn(allValues, attribute);
}

/**
 * Seal's default attribute (field label) translation for Warlock.
 *
 * Looks the label up under `<attributeGroup>.<field>` (`attributes.<field>`
 * by default). When the app did not set an attribute group, a label under
 * `validation.attributes.<field>` is used too. A field without a label is
 * humanised (`max_dumbbell_kg` becomes "Max dumbbell kg") unless `humanize`
 * is `false`.
 */
export function translateSealAttribute({
  attribute,
  key,
  allValues,
  attributeGroup,
  humanize = true,
  translate,
}: TranslateSealAttributeOptions): string {
  const group = attributeGroup ?? "attributes";
  const translationKey = `${group ? group + "." : ""}${attribute}`;
  const output = translate(translationKey, allValues as Record<string, unknown> | undefined);

  if (output !== translationKey) return output;

  if (attributeGroup === undefined) {
    const nestedKey = `validation.attributes.${attribute}`;
    const nested = translate(nestedKey, allValues as Record<string, unknown> | undefined);

    if (nested !== nestedKey) return nested;
  }

  return humanize && isFieldName(attribute, key, allValues)
    ? humanizeAttribute(attribute)
    : attribute;
}
