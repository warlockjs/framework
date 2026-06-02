import { isLazy, type Lazy } from "@mongez/reinforcements";
import type { RelationDefinition } from "../relations/types";
import type { ChildModel, Model } from "./model";
import { RELATION_METADATA_KEY } from "./relation-decorators";

/**
 * Any way a relation target can be expressed: a string name registered
 * via `@RegisterModel()`, a direct class reference, or a `lazy(() => X)`
 * deferred class reference (for cycle-prone pairs).
 *
 * The lazy variant is typed as `Lazy<unknown>` (not `Lazy<ChildModel<Model>>`)
 * because `RelationDefinition.model` storage uses the same broader shape —
 * keeping the parameter type aligned avoids forcing every call site to
 * narrow before invoking the resolver. The helpers cast the resolved
 * class to `ChildModel<Model>` internally; the user's `lazy(() => X)`
 * call already guarantees the shape at the source.
 */
export type ModelRef = ChildModel<Model> | string | Lazy<unknown>;

/**
 * Options for the RegisterModel decorator
 */
export type RegisterModelOptions = {
  /**
   * Custom name for the model in the global registry.
   * If not provided, uses the class name.
   *
   * @example
   * ```typescript
   * @RegisterModel({ name: "CustomUser" })
   * export class User extends Model {}
   * ```
   */
  name?: string;
};

/**
 * Global model registry that maps model class names to their constructors.
 * This allows for string-based model references to avoid circular dependencies.
 */
const modelsRegistry = new Map<string, ChildModel<Model>>();

/**
 * Class decorator that registers a model in the global registry.
 *
 * This is an opt-in mechanism that allows models to be referenced by string name
 * instead of direct class imports, helping avoid circular dependencies.
 *
 * Uses the **TC39 Stage 3 decorator** signature (standard since TypeScript 5.0).
 * Requires `experimentalDecorators: false` (or unset) in `tsconfig.json`.
 *
 * @param options - Optional configuration for registration
 *
 * @example
 * ```typescript
 * // Auto-capture class name
 * @RegisterModel()
 * export class User extends Model {
 *   static table = "users";
 * }
 *
 * // Custom name
 * @RegisterModel({ name: "UserModel" })
 * export class User extends Model {
 *   static table = "users";
 * }
 *
 * // Later, retrieve by name:
 * const UserModel = getModelFromRegistry("User");
 * ```
 */
export function RegisterModel(options?: RegisterModelOptions) {
  return function <T extends ChildModel<Model>>(value: T, context: ClassDecoratorContext<T>): T {
    if (context.kind !== "class") {
      throw new Error(`@RegisterModel can only be applied to classes — got "${context.kind}".`);
    }

    const modelName = options?.name || (context.name ?? value.name);

    if (!modelName) {
      throw new Error(
        "@RegisterModel decorator: Unable to determine model name. " +
          "Please provide a name in options or ensure your class has a name.",
      );
    }

    if (modelsRegistry.has(modelName)) {
      console.warn(
        `⚠️  Model "${modelName}" is already registered. ` +
          `This will overwrite the previous registration.`,
      );
    }

    // Hoist relation definitions stashed by `@BelongsTo` / `@HasMany` /
    // etc. on this class's decorator-metadata bag onto the class's static
    // `relations` map. Field-decorator initializers are instance-level in
    // TC39 stage 3 — they never fire for class-level operations like
    // `Model.withCount("rel")`. Reading via shared `context.metadata` is
    // the right hand-off point because all field decorators have already
    // run by the time the class decorator executes.
    const decoratorRelations = context.metadata?.[RELATION_METADATA_KEY] as
      | Record<string, RelationDefinition>
      | undefined;

    if (decoratorRelations && Object.keys(decoratorRelations).length > 0) {
      const ownRelations = Object.prototype.hasOwnProperty.call(value, "relations")
        ? (value as unknown as { relations: Record<string, RelationDefinition> }).relations
        : { ...((value as unknown as { relations?: Record<string, RelationDefinition> }).relations ?? {}) };

      (value as unknown as { relations: Record<string, RelationDefinition> }).relations = {
        ...ownRelations,
        ...decoratorRelations,
      };
    }

    modelsRegistry.set(modelName, value);

    return value;
  };
}

export function registerModelInRegistry(name: string, model: ChildModel<Model>) {
  modelsRegistry.set(name, model);
}

/**
 * Get a model class by its name from the global registry.
 *
 * @param name - The model class name
 * @returns The model class or undefined if not found
 *
 * @example
 * ```typescript
 * const UserModel = getModelFromRegistry("User");
 * if (UserModel) {
 *   const user = await UserModel.find(1);
 * }
 * ```
 */
export function getModelFromRegistry(name: string) {
  return modelsRegistry.get(name);
}

/**
 * Get all registered models from the global registry.
 *
 * @returns A Map of all registered model classes by name
 *
 * @example
 * ```typescript
 * const allModels = getAllModelsFromRegistry();
 * for (const [name, ModelClass] of allModels) {
 *   console.log(`Found model: ${name}`);
 * }
 * ```
 */
export function getAllModelsFromRegistry() {
  return new Map(modelsRegistry);
}

/**
 * Clean up all models from register
 */
export function cleanupModelsRegistery() {
  modelsRegistry.clear();
}

export function removeModelFromRegistery(name: string) {
  modelsRegistry.delete(name);
}

export function resolveModelClass(model: ModelRef): ChildModel<Model> {
  if (typeof model === "string") return getModelFromRegistry(model)!;
  if (isLazy(model)) return model.resolve() as ChildModel<Model>;

  return model;
}

/**
 * Like `resolveModelClass`, but returns `undefined` instead of asserting
 * a non-null result when a string ref isn't in the registry. Use this
 * at call sites that already handle the missing-model case explicitly
 * (e.g. join builders that throw their own contextual error).
 */
export function tryResolveModelClass(
  model: ModelRef | undefined,
): ChildModel<Model> | undefined {
  if (model === undefined) return undefined;
  if (typeof model === "string") return getModelFromRegistry(model);
  if (isLazy(model)) return model.resolve() as ChildModel<Model>;

  return model;
}

/**
 * Read the model's registered name from any `ModelRef`. Used by
 * convention helpers (`inferPivotTable`, `inferPivotKey`) that derive
 * table / column names from the related model's class name.
 *
 * For string refs the value passes through. For class and lazy refs
 * the class's `.name` is returned — same string the registry would
 * key the class under, so conventions stay consistent across ref shapes.
 */
export function resolveModelName(model: ModelRef): string {
  if (typeof model === "string") return model;
  if (isLazy(model)) return (model.resolve() as ChildModel<Model>).name;

  return model.name;
}

/**
 * Walk every registered model and verify that every relation declared on it
 * points at another registered model. Throws fast at boot with a clear error
 * naming the unresolved target — much better signal than the runtime
 * "Model not found" thrown deep inside a query.
 *
 * Call this once during app bootstrap, after every `@RegisterModel`-decorated
 * model module has been imported.
 *
 * @returns The number of relations verified (success case)
 * @throws Error listing every unresolved relation target if any are missing
 *
 * @example
 * ```typescript
 * // Inside your app bootstrap, after model imports:
 * import { verifyRegisteredRelations } from "@warlock.js/cascade";
 * verifyRegisteredRelations();
 * ```
 */
export function verifyRegisteredRelations(): number {
  type RelationDef = { type: string; model: string };
  const failures: Array<{ caller: string; relation: string; target: string }> = [];

  let verifiedCount = 0;

  for (const [callerName, ModelClass] of modelsRegistry) {
    const relations = (ModelClass as { relations?: Record<string, RelationDef> }).relations;

    if (!relations) {
      continue;
    }

    for (const [relationName, definition] of Object.entries(relations)) {
      verifiedCount++;
      const targetName = definition.model;

      if (typeof targetName !== "string") {
        // Direct class reference or `lazy(() => X)` — class binding is
        // captured by the decorator at definition time; can't drift.
        continue;
      }

      if (!modelsRegistry.has(targetName)) {
        failures.push({ caller: callerName, relation: relationName, target: targetName });
      }
    }
  }

  if (failures.length > 0) {
    const list = failures
      .map((f) => `  - ${f.caller}.${f.relation} → "${f.target}" is not registered`)
      .join("\n");
    throw new Error(
      `verifyRegisteredRelations: ${failures.length} unresolved relation target(s):\n${list}\n` +
        `Each target must be decorated with @RegisterModel() and imported before bootstrap.`,
    );
  }

  return verifiedCount;
}
