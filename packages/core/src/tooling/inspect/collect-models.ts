import { isLazy } from "@mongez/reinforcements";
import { getAllModelsFromRegistry } from "@warlock.js/cascade";
import type { SchemaRegistry } from "../../openapi/schema-registry";
import type {
  InspectModel,
  InspectModelColumn,
  InspectModelRelation,
  InspectResource,
  InspectWarning,
  JsonSchema,
} from "./inspect-report.types";

/** A model module the boot pass imported: its file and its exports. */
export type InspectModelModule = {
  /** Project-relative path. */
  file: string;
  exports: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A static property of a class, read structurally. */
function staticOf(model: unknown, key: string): unknown {
  return typeof model === "function" ? Reflect.get(model, key) : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Whether a value is a Cascade model class: a class with its own `table` and
 * the static `query()` every model inherits. Read by shape, not `instanceof`.
 */
export function isModelClass(value: unknown): value is (...args: never[]) => unknown {
  return (
    typeof value === "function" &&
    typeof Reflect.get(value, "table") === "string" &&
    typeof Reflect.get(value, "query") === "function"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readColumns(
  model: unknown,
  name: string,
  warnings: InspectWarning[],
): InspectModelColumn[] {
  const schema = staticOf(model, "schema");

  if (typeof schema !== "object" || schema === null) return [];

  const convert = Reflect.get(schema, "toJsonSchema");

  if (typeof convert !== "function") return [];

  let json: unknown;

  try {
    json = convert.call(schema, "draft-2020-12");
  } catch (error) {
    warnings.push({
      code: "WL4001",
      message: `${name}.schema could not be converted to JSON Schema: ${errorMessage(error)}`,
      source: "models",
    });

    return [];
  }

  if (!isRecord(json) || !isRecord(json.properties)) {
    return [];
  }

  const required = new Set(
    Array.isArray(json.required) ? json.required.filter((key) => typeof key === "string") : [],
  );

  return Object.entries(json.properties)
    .map(([column, columnSchema]) => ({
      name: column,
      required: required.has(column),
      schema: isRecord(columnSchema) ? (columnSchema as JsonSchema) : {},
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

/** The name of a relation target given as a string, a class or `lazy(() => X)`. */
function relationTargetName(target: unknown): string | null {
  if (typeof target === "string") return target;

  try {
    const resolved = isLazy(target) ? target.resolve() : target;

    return typeof resolved === "function" && resolved.name ? resolved.name : null;
  } catch {
    return null;
  }
}

function readRelations(model: unknown): InspectModelRelation[] {
  const relations = staticOf(model, "relations");

  if (!isRecord(relations)) return [];

  return Object.entries(relations)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([name, definition]) => ({
      name,
      type: typeof definition.type === "string" ? definition.type : "unknown",
      model: relationTargetName(definition.model),
      foreignKey: stringOrNull(definition.foreignKey),
      localKey: stringOrNull(definition.localKey),
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

function columnSetting(model: unknown, key: string): string | null {
  return stringOrNull(staticOf(model, key));
}

/** The outcome of {@link collectModels}: the models plus the resources they name. */
export type CollectedModels = {
  models: InspectModel[];
  /** Resource classes keyed by the name they got in `components.schemas`, with their models. */
  resourceModels: Map<string, string[]>;
};

/**
 * Describe every model the app defines: the classes exported by the model
 * modules the boot pass imported, plus everything `@RegisterModel()` put in
 * Cascade's registry. Columns come from the model's Seal `schema` as JSON
 * Schema; the model's resource is registered in `registry` so its output
 * shape lands in `components.schemas`.
 */
export function collectModels(
  modules: readonly InspectModelModule[],
  registry: SchemaRegistry,
  warnings: InspectWarning[],
): CollectedModels {
  const found = new Map<
    unknown,
    { name: string; sourceFile: string | null; registered: boolean }
  >();

  for (const module of modules) {
    for (const [exportName, value] of Object.entries(module.exports)) {
      if (!isModelClass(value) || found.has(value)) continue;

      found.set(value, {
        name: value.name || exportName,
        sourceFile: module.file,
        registered: false,
      });
    }
  }

  for (const [name, model] of getAllModelsFromRegistry()) {
    const existing = found.get(model);

    if (existing) {
      existing.registered = true;
      existing.name = name;
    } else {
      found.set(model, { name, sourceFile: null, registered: true });
    }
  }

  const resourceModels = new Map<string, string[]>();
  const models: InspectModel[] = [];

  for (const [model, meta] of found) {
    try {
      const resource = staticOf(model, "resource");
      let resourceName: string | null = null;

      if (registry.isResourceClass(resource)) {
        const ref = registry.resourceRef(resource).$ref;

        resourceName = typeof ref === "string" ? (ref.split("/").pop() ?? null) : null;

        if (resourceName) {
          resourceModels.set(resourceName, [
            ...(resourceModels.get(resourceName) ?? []),
            meta.name,
          ]);
        }
      }

      const dataSource = staticOf(model, "dataSource");
      const deletedAt = staticOf(model, "deletedAtColumn");

      models.push({
        name: meta.name,
        table: stringOrNull(staticOf(model, "table")),
        primaryKey: stringOrNull(staticOf(model, "primaryKey")),
        dataSource: stringOrNull(dataSource),
        sourceFile: meta.sourceFile,
        registered: meta.registered,
        columns: readColumns(model, meta.name, warnings),
        relations: readRelations(model),
        resource: resourceName,
        deleteStrategy: columnSetting(model, "deleteStrategy"),
        createdAtColumn: columnSetting(model, "createdAtColumn"),
        updatedAtColumn: columnSetting(model, "updatedAtColumn"),
        deletedAtColumn: stringOrNull(deletedAt),
      });
    } catch (error) {
      warnings.push({
        code: null,
        message: `Model ${meta.name} could not be described: ${errorMessage(error)}`,
        source: meta.sourceFile ?? "models",
      });
    }
  }

  return {
    models: models.sort((first, second) => first.name.localeCompare(second.name)),
    resourceModels,
  };
}

/**
 * Every resource in `components.schemas`, with the models that use it. Called
 * after routes and models registered their resources.
 */
export function collectResources(
  registry: SchemaRegistry,
  resourceModels: ReadonlyMap<string, string[]>,
): InspectResource[] {
  return Object.entries(registry.schemas)
    .map(([name, schema]) => ({
      name,
      schema,
      models: [...(resourceModels.get(name) ?? [])].sort(),
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}
