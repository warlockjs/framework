import type { Infer, ObjectValidator } from "@warlock.js/seal";
import type { ModelSchema } from "../model/model";
import { Model } from "../model/model";
import { registerModelInRegistry } from "../model/register-model";
import type { DeleteStrategy, StrictMode } from "../types";

/**
 * Configuration options for defining a model.
 */
export type DefineModelOptions<TSchema extends ModelSchema> = {
  /**
   * The database table/collection name.
   */
  table: string;

  /**
   * Model name
   * If provided, it will be registered in the models registery
   */
  name?: string;

  /**
   * The validation schema for the model.
   * Use `v.object()` from @warlock.js/seal to define the schema.
   */
  schema: ObjectValidator;

  /**
   * Delete strategy for this model. Controls how `destroy()` handles records.
   *
   * - `"trash"` — Moves the record to a trash table/collection, then deletes from the source.
   * - `"permanent"` — Hard delete. The record is removed from the database.
   * - `"soft"` — Sets a `deletedAt` timestamp; the row stays in place.
   *
   * When omitted, the runtime resolves the strategy in this priority order:
   * `destroy()` call options → this model's static → data source `defaultDeleteStrategy` → `"permanent"`.
   */
  deleteStrategy?: DeleteStrategy;

  /**
   * Behavior when the model is asked to write a field that is not declared in `schema`.
   *
   * - `"strip"` — Drop unknown fields silently (default).
   * - `"fail"` — Throw a validation error on unknown fields.
   * - `"allow"` — Pass unknown fields through to the database as-is.
   */
  strictMode?: StrictMode;

  /**
   * Auto-generate a sequential `id` field on insert (NoSQL only).
   *
   * SQL drivers use native AUTO_INCREMENT and ignore this. When omitted, the
   * MongoDB driver defaults to `true`; the PostgreSQL driver defaults to `false`.
   */
  autoGenerateId?: boolean;

  /**
   * Use a random increment (1–10) instead of a fixed step when auto-generating IDs.
   *
   * When omitted, falls through to the driver/data-source default.
   */
  randomIncrement?: boolean;

  /**
   * Initial ID value for the first record when auto-generating IDs.
   *
   * When omitted, falls through to the driver/data-source default (typically `1`).
   */
  initialId?: number;

  /**
   * Optional: Custom instance properties (getters/setters/methods).
   * Define computed properties, custom getters, or instance methods.
   *
   * The `this` context will be the Model instance, giving you access to
   * all Model methods like `get()`, `set()`, `save()`, etc.
   *
   * @example
   * ```typescript
   * properties: {
   *   get fullName(this: Model<UserSchema>) {
   *     return `${this.get("firstName")} ${this.get("lastName")}`;
   *   },
   *   get isActive(this: Model<UserSchema>) {
   *     return this.get("status") === "active";
   *   },
   *   async sendEmail(this: Model<UserSchema>, subject: string) {
   *     // this.get(), this.save(), etc. all work!
   *   },
   * }
   * ```
   */
  properties?: ThisType<Model<TSchema>> & Record<string, any>;

  /**
   * Optional: Custom static methods.
   * Define class-level methods like custom finders or utilities.
   *
   * @example
   * ```typescript
   * statics: {
   *   async findByEmail(email: string) {
   *     return this.first({ email });
   *   },
   *   async findActive() {
   *     return this.query().where("status", "active").get();
   *   },
   * }
   * ```
   */
  statics?: Record<string, any>;
};

/**
 * Define a model with a clean, concise API.
 *
 * This utility function creates a Model class with the specified configuration,
 * reducing boilerplate and providing a more declarative way to define models.
 *
 * @param options - Model configuration options
 * @returns A Model class with the specified configuration
 *
 * @example
 * ```typescript
 * import { defineModel } from "@warlock.js/cascade";
 * import { v } from "@warlock.js/seal";
 *
 * export const User = defineModel({
 *   table: "users",
 *   schema: v.object({
 *     name: v.string().required().trim(),
 *     email: v.string().email().required().lowercase(),
 *     password: v.string().required().min(6),
 *     role: v.string().default("user"),
 *   }),
 *   deleteStrategy: "soft",
 * });
 *
 * // Usage
 * const user = await User.create({
 *   name: "John Doe",
 *   email: "john@example.com",
 *   password: "secret123",
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With type inference
 * export const Post = defineModel({
 *   table: "posts",
 *   schema: v.object({
 *     title: v.string().required(),
 *     content: v.string().required(),
 *     authorId: v.number().required(),
 *     published: v.boolean().default(false),
 *   }),
 * });
 *
 * // TypeScript knows the exact type!
 * const post = await Post.create({
 *   title: "Hello World",
 *   content: "My first post",
 *   authorId: 1,
 * });
 *
 * console.log(post.title); // ✅ Type-safe!
 * ```
 */
export function defineModel<
  TSchema extends ModelSchema,
  TSchemaValidator extends ObjectValidator = ObjectValidator,
  TProperties extends Record<string, any> = {},
  TStatics extends Record<string, any> = {},
>(
  options: DefineModelOptions<TSchema> & {
    schema: TSchemaValidator;
    properties?: ThisType<Model<Infer.Output<TSchemaValidator>>> & TProperties;
    statics?: ThisType<typeof Model<Infer.Output<TSchemaValidator>>> & TStatics;
  },
) {
  type InferredSchema = Infer.Output<TSchemaValidator>;

  class DefinedModel extends Model<InferredSchema> {
    /**
     * Table/collection name
     */
    public static table = options.table;

    /**
     * Validation schema
     */
    public static schema = options.schema;

    /**
     * Delete strategy. When undefined, the runtime resolves via call options →
     * data source `defaultDeleteStrategy` → `"permanent"`.
     */
    public static deleteStrategy: DeleteStrategy | undefined = options.deleteStrategy;

    /**
     * Strict mode for unknown fields. Defaults to `"strip"` to match the base
     * `Model` static default.
     */
    public static strictMode: StrictMode = options.strictMode || "strip";

    /**
     * Auto-generate sequential IDs (NoSQL only). Defaults to `true` to match
     * the base `Model` static default.
     */
    public static autoGenerateId: boolean = options.autoGenerateId ?? true;

    /**
     * Random increment for auto-generated IDs. When undefined, falls through
     * to the data-source default.
     */
    public static randomIncrement: boolean | undefined = options.randomIncrement;

    /**
     * Initial ID value for the first record when auto-generating IDs. When
     * undefined, falls through to the data-source default.
     */
    public static initialId: number | undefined = options.initialId;
  }

  // Apply custom instance properties (getters/setters/methods)
  if (options.properties) {
    Object.defineProperties(
      DefinedModel.prototype,
      Object.getOwnPropertyDescriptors(options.properties),
    );
  }

  if (options.name) {
    registerModelInRegistry(options.name, DefinedModel);
  }

  // Apply custom static methods
  if (options.statics) {
    Object.defineProperties(DefinedModel, Object.getOwnPropertyDescriptors(options.statics));
  }

  // Return with proper type inference.
  //
  // The constructed type references the EXPORTED `Model` (instance + statics)
  // rather than the local `DefinedModel` class. `DefinedModel` is declared
  // inside this function, so emitting it into the public `.d.ts` would force the
  // declaration emitter to inline it as an anonymous class type — which fails
  // with TS4094 ("anonymous class type may not be private or protected", from
  // Model's `protected isActiveColumn`) and crashes the dts bundler on Model's
  // getters. `DefinedModel` adds no instance members over `Model<InferredSchema>`
  // and no statics beyond those already declared on `Model`, so this is a
  // faithful, emittable equivalent of the previously-inferred return type.
  type DefinedModelClass = {
    new (initialData?: Partial<InferredSchema>): Model<InferredSchema> & TProperties;
  } & Omit<typeof Model, "new"> &
    TStatics;

  return DefinedModel as unknown as DefinedModelClass;
}

/**
 * Type helper to infer the schema type from a defined model.
 *
 * @example
 * ```typescript
 * const User = defineModel({
 *   table: "users",
 *   schema: v.object({
 *     name: v.string(),
 *     email: v.string(),
 *   }),
 * });
 *
 * type UserType = ModelType<typeof User>;
 * // { name: string; email: string; }
 * ```
 */
export type ModelType<T extends ReturnType<typeof defineModel>> = T extends new (
  ...args: any[]
) => infer R
  ? R extends Model<infer S>
    ? S
    : never
  : never;
