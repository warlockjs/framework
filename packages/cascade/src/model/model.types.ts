import type { Infer, ObjectValidator } from "@warlock.js/seal";
import type { QueryBuilderContract } from "../contracts";
import type { Model } from "./model";

/**
 * Timing control for global scopes
 */
export type ScopeTiming = "before" | "after";

/**
 * Global scope definition with callback and timing
 */
export type GlobalScopeDefinition = {
  callback: (query: QueryBuilderContract) => void;
  timing: ScopeTiming;
};

/**
 * Local scope callback function
 */
export type LocalScopeCallback = (query: QueryBuilderContract, ...args: any[]) => void;

/**
 * Options for adding global scopes
 */
export type GlobalScopeOptions = {
  timing?: ScopeTiming;
};

/**
 * Generic schema type representing the structure of model data.
 */
export type ModelSchema = Record<string, any>;

/**
 * Whether a model schema type is the loose default (`Record<string, any>`),
 * that is, the model declares no column list.
 */
export type IsLooseModelSchema<TSchema> = string extends keyof TSchema ? true : false;

/**
 * The columns Cascade manages on every record, so `get()` and `set()` accept
 * them on a typed model without declaring them in the schema.
 *
 * - `id` is the numeric id Cascade generates. A model with string ids
 *   declares `id: string` in its schema, and the schema wins.
 * - `_id` is the MongoDB document id.
 * - Timestamp column names depend on the driver (`createdAt` on MongoDB,
 *   `created_at` on Postgres) and can be renamed or disabled per model, so
 *   both spellings are allowed. A model that renames one declares it in
 *   its schema, and the schema wins.
 * - `deleted_at` / `deletedAt` hold the soft-delete time, `null` while the
 *   record is live.
 */
export type ModelSystemColumns = {
  id: number;
  _id: unknown;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

/**
 * A model schema plus Cascade's system columns. A column the schema declares
 * keeps the schema type. A loose schema stays as it is.
 */
export type ModelColumns<TSchema> = string extends keyof TSchema
  ? TSchema
  : Omit<ModelSystemColumns, keyof TSchema> & TSchema;

/**
 * The column names `get()`, `set()` and friends accept for a model schema.
 * A typed schema allows its keys and the system columns; a loose one allows
 * any string.
 */
export type ModelKey<TSchema> = string extends keyof TSchema
  ? string
  : keyof ModelColumns<TSchema> & string;

/**
 * The value type of one column: the schema type for a typed model, `any`
 * for a loose one.
 */
export type ModelValue<TSchema, TKey> = TKey extends keyof ModelColumns<TSchema>
  ? ModelColumns<TSchema>[TKey]
  : never;

/**
 * A dot-notation path into a nested column (`"address.city"`). Nested paths
 * are loosely typed on purpose: a recursive path type grows with the schema
 * and is the slowest type to check on large models.
 */
export type ModelPath = `${string}.${string}`;

/**
 * The data a model holds, inferred from its seal schema with casts applied
 * (`v.date()` is `Date`, `v.int()` is `number`, `.nullable()` is `T | null`,
 * `.default()` is always present).
 *
 * @example
 * ```ts
 * export type UserSchema = ModelData<typeof userSchema>;
 *
 * class User extends Model<UserSchema> {
 *   public static schema = userSchema;
 * }
 * ```
 */
export type ModelData<TValidator extends ObjectValidator> = Infer.Output<TValidator>;

/**
 * A read-only snapshot of a model's data (`model.toDataSnapshot()`), also the
 * natural input type of a resource built from the model.
 */
export type ModelDataSnapshot<TSchema> = Readonly<TSchema>;

/**
 * Represents the static side of a model subclass.
 *
 * Used for `this`-typed static methods so TypeScript can infer the concrete
 * subclass and return the correct model type from static factory methods like
 * `find()`, `create()`, `query()`, etc.
 *
 * @example
 * ```ts
 * public static async find<TModel extends Model>(
 *   this: ChildModel<TModel>,
 *   id: number,
 * ): Promise<TModel | null>
 * ```
 */
export type ChildModel<TModel extends Model> = (new (...args: any[]) => TModel) &
  Pick<
    typeof Model,
    | "table"
    | "primaryKey"
    | "dataSource"
    | "schema"
    | "strictMode"
    | "autoGenerateId"
    | "initialId"
    | "randomInitialId"
    | "incrementIdBy"
    | "resource"
    | "resourceColumns"
    | "toJsonColumns"
    | "hidden"
    | "randomIncrement"
    | "getDataSource"
    | "getDriver"
    | "query"
    | "find"
    | "first"
    | "last"
    | "all"
    | "latest"
    | "count"
    | "where"
    | "increase"
    | "decrease"
    | "atomic"
    | "events"
    | "on"
    | "once"
    | "off"
    | "globalEvents"
    | "delete"
    | "deleteOne"
    | "deleteStrategy"
    | "trashTable"
    | "restore"
    | "restoreAll"
    | "deletedAtColumn"
    | "createdAtColumn"
    | "updatedAtColumn"
    | "create"
    | "createMany"
    | "sync"
    | "embed"
    | "syncMany"
    | "addGlobalScope"
    | "removeGlobalScope"
    | "addScope"
    | "removeScope"
    | "localScopes"
    | "globalScopes"
    | "relations"
    | "newQueryBuilder"
    | "builder"
    | "findAndUpdate"
    | "findOneAndUpdate"
    | "hydrate"
    | "fromSnapshot"
    | "findAndReplace"
    | "findOneAndDelete"
    | "findOrCreate"
  >;
