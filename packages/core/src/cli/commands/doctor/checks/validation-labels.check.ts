import { getKeywordsListOf, transFromKeywords } from "@mongez/localization";
import { config } from "../../../../config/config-getter";
import { router } from "../../../../router/router";
import type { DoctorCheck } from "../check.types";

/** How many missing fields a locale line spells out before it says "and N more". */
const LISTED_FIELDS = 8;

type SchemaLike = { schema?: Record<string, unknown> };

function objectShape(validator: unknown): Record<string, unknown> | undefined {
  const shape = (validator as SchemaLike | undefined)?.schema;

  return typeof shape === "object" && shape !== null ? shape : undefined;
}

/** Field keys of an object schema, including the keys of nested object schemas. */
function collectFields(validator: unknown, into: Set<string>, depth = 0): void {
  const shape = objectShape(validator);

  if (!shape || depth > 5) return;

  for (const [key, child] of Object.entries(shape)) {
    into.add(key);
    collectFields(child, into, depth + 1);
  }
}

/** Field keys of every request schema (`validation.schema`) the router registered. */
function requestSchemaFields(): Set<string> {
  const fields = new Set<string>();

  for (const route of router.list()) {
    const handlerValidation = (route.handler as { validation?: { schema?: unknown } } | undefined)
      ?.validation;

    collectFields(handlerValidation?.schema, fields);
    collectFields(route.validation?.schema, fields);
  }

  return fields;
}

function configuredLocales(): string[] {
  const codes = config.key<unknown>("app.localeCodes");

  if (Array.isArray(codes) && codes.length > 0 && codes.every((code) => typeof code === "string")) {
    return codes;
  }

  const code = config.key<unknown>("app.localeCode");

  return [typeof code === "string" && code.length > 0 ? code : "en"];
}

/** Whether `locale` itself defines `key`, without the fallback locale standing in for it. */
function definesKey(locale: string, key: string): boolean {
  return transFromKeywords(locale, getKeywordsListOf(locale) ?? {}, key) !== key;
}

function hasLabel(locale: string, field: string, attributeGroup: string | undefined): boolean {
  const group = attributeGroup ?? "attributes";
  const key = `${group ? group + "." : ""}${field}`;

  if (definesKey(locale, key)) return true;

  if (attributeGroup != null) return false;

  const nestedKey = `validation.attributes.${field}`;

  return definesKey(locale, nestedKey);
}

/**
 * Lists request-schema fields that have no translated label in a configured
 * locale. Without a label, validation messages show the field name turned into
 * words ("Max dumbbell kg"), which is right in English and wrong everywhere else.
 *
 * OPT-IN: runs only when `validation.warnMissingLabels` is `true`, because most
 * apps rely on the humanised names and a warning for every unlabelled field
 * would be noise. Stays silent when the app translates attributes with its own
 * `validation.translateAttribute`, whose labels this check cannot see, and when
 * no request schema is registered.
 *
 * NEEDS A BOOTED APP: routes (and their schemas) exist only once the app's
 * modules were imported.
 */
export const validationLabelsCheck: DoctorCheck = {
  name: "validation-labels",
  run: (context) => {
    if (config.key("validation.warnMissingLabels") !== true) return undefined;
    if (config.key("validation.translateAttribute")) return undefined;
    if (!context.booted) return undefined;

    const fields = [...requestSchemaFields()].sort();

    if (fields.length === 0) return undefined;

    const attributeGroup = config.key<string | undefined>("validation.attributeGroup");
    const lines: string[] = [];

    for (const locale of configuredLocales()) {
      const missing = fields.filter((field) => !hasLabel(locale, field, attributeGroup));

      if (missing.length === 0) continue;

      const listed = missing.slice(0, LISTED_FIELDS).join(", ");
      const rest =
        missing.length > LISTED_FIELDS ? ` and ${missing.length - LISTED_FIELDS} more` : "";

      lines.push(`  - ${locale}: ${listed}${rest}`);
    }

    if (lines.length === 0) {
      return {
        name: "validation-labels",
        status: "ok",
        detail: "every request-schema field has a label in each configured locale",
      };
    }

    return {
      name: "validation-labels",
      status: "warn",
      code: "WL4002",
      detail:
        "request-schema fields without a label (messages fall back to the field name in words):\n" +
        lines.join("\n") +
        `\n  Add them under \`${attributeGroup ?? "attributes"}\` in the locale files.`,
    };
  },
};
