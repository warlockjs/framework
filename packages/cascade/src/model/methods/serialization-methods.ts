import type { GenericObject } from "@mongez/reinforcements";
import type { ChildModel, Model } from "../model";

/**
 * Field names that commonly hold credentials/secrets. Used only to emit a
 * one-time warning when such a field exists in a model's schema but is not
 * covered by `hidden`/`resource`/`toJsonColumns` — the fail-open default
 * (`toJSON()` returns the raw document) would leak it.
 */
const SENSITIVE_FIELD_PATTERN = /^(password|passwordHash|secret|token|apiKey|api_key)$/i;

const warnedModelClasses = new WeakSet<object>();

/**
 * Warn once per model class when its schema declares a sensitive-looking field
 * that serialization would expose: no `hidden` entry for it, no `resource`
 * class, and no `toJsonColumns` allow-list excluding it.
 *
 * A warning rather than an error — the fail-open `toJSON()` default is kept
 * for compatibility, but it should at least be loud.
 */
export function warnUndeclaredSensitiveFields(ModelClass: ChildModel<Model>): void {
  if (warnedModelClasses.has(ModelClass)) return;
  warnedModelClasses.add(ModelClass);

  const schema = ModelClass.schema;
  if (!schema) return;

  const hidden = ModelClass.hidden ?? [];
  const toJsonColumns = ModelClass.toJsonColumns;

  const exposed = Object.keys(schema.schema).filter((field) => {
    if (!SENSITIVE_FIELD_PATTERN.test(field)) return false;
    if (hidden.includes(field)) return false;
    if (ModelClass.resource) return false;
    if (toJsonColumns && toJsonColumns.length > 0 && !toJsonColumns.includes(field)) return false;
    return true;
  });

  if (exposed.length === 0) return;

  console.warn(
    `[cascade] Model "${ModelClass.name}" (table "${ModelClass.table}") has sensitive-looking schema field(s) ${exposed
      .map((field) => `"${field}"`)
      .join(", ")} that toJSON()/JSON.stringify() will include in output. ` +
      `Add them to \`static hidden = [...]\` (or configure \`resource\`/\`toJsonColumns\`) so they cannot leak via res.json(model).`,
  );
}

/**
 * Return `data` without the model's `hidden` top-level fields.
 * Returns `data` untouched (same reference) when nothing is hidden.
 */
function stripHiddenFields(
  data: Record<string, unknown>,
  hidden: string[],
): Record<string, unknown> {
  if (hidden.length === 0) return data;

  const output = { ...data };
  for (const field of hidden) {
    delete output[field];
  }
  return output;
}

export function modelToJSON(model: Model): Record<string, unknown> {
  const ModelClass = model.self();
  const resource = ModelClass.resource;
  const hidden = ModelClass.hidden ?? [];

  warnUndeclaredSensitiveFields(ModelClass);

  if (!resource) {
    const toJsonColumns = ModelClass.toJsonColumns;
    if (toJsonColumns && toJsonColumns.length > 0) {
      return stripHiddenFields(model.only(toJsonColumns), hidden);
    }
    return stripHiddenFields(model.data, hidden);
  }

  const resourceColumns = ModelClass.resourceColumns;
  let data: GenericObject =
    resourceColumns !== undefined && resourceColumns.length > 0
      ? model.only(resourceColumns)
      : { ...model.data };

  for (const [relationName, relatedModel] of model.loadedRelations) {
    if (Array.isArray(relatedModel)) {
      data[relationName] = relatedModel.map((m) =>
        m instanceof Object && typeof m.toJSON === "function" ? m.toJSON() : m,
      );
    } else if (relatedModel instanceof Object && typeof relatedModel.toJSON === "function") {
      data[relationName] = relatedModel.toJSON();
    } else {
      data[relationName] = relatedModel;
    }
  }

  return new resource(stripHiddenFields(data, hidden)).toJSON();
}
