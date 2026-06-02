import { type Lazy } from "@mongez/reinforcements";
import type { ChildModel, Model } from "./model";
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
export declare function RegisterModel(options?: RegisterModelOptions): <T extends ChildModel<Model>>(value: T, context: ClassDecoratorContext<T>) => T;
export declare function registerModelInRegistry(name: string, model: ChildModel<Model>): void;
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
export declare function getModelFromRegistry(name: string): ChildModel<Model<import("./model.types").ModelSchema>> | undefined;
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
export declare function getAllModelsFromRegistry(): Map<string, ChildModel<Model<import("./model.types").ModelSchema>>>;
/**
 * Clean up all models from register
 */
export declare function cleanupModelsRegistery(): void;
export declare function removeModelFromRegistery(name: string): void;
export declare function resolveModelClass(model: ModelRef): ChildModel<Model>;
/**
 * Like `resolveModelClass`, but returns `undefined` instead of asserting
 * a non-null result when a string ref isn't in the registry. Use this
 * at call sites that already handle the missing-model case explicitly
 * (e.g. join builders that throw their own contextual error).
 */
export declare function tryResolveModelClass(model: ModelRef | undefined): ChildModel<Model> | undefined;
/**
 * Read the model's registered name from any `ModelRef`. Used by
 * convention helpers (`inferPivotTable`, `inferPivotKey`) that derive
 * table / column names from the related model's class name.
 *
 * For string refs the value passes through. For class and lazy refs
 * the class's `.name` is returned — same string the registry would
 * key the class under, so conventions stay consistent across ref shapes.
 */
export declare function resolveModelName(model: ModelRef): string;
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
export declare function verifyRegisteredRelations(): number;
//# sourceMappingURL=register-model.d.ts.map