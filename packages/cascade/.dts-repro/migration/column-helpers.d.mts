import { VectorIndexOptions } from "../contracts/migration-driver.contract.mjs";
import { ColumnBuilder } from "./column-builder.mjs";

//#region ../../@warlock.js/cascade/src/migration/column-helpers.d.ts
/**
 * A no-op migration sink used by standalone column helpers.
 *
 * When column helpers are used in `Migration.create()` / `Migration.alter()`,
 * the builder is constructed without a real migration context. The actual
 * operations are dequeued from the ColumnBuilder's definition and replayed
 * onto the real migration instance at execution time.
 *
 * Index and FK operations queued on this sink are collected and transferred
 * to the real migration by the factory methods.
 */
declare class DetachedMigrationSink {
  /** Pending indexes registered via .unique() / .index() on a helper column. */
  readonly pendingIndexes: {
    columns: string[];
    unique?: boolean;
  }[];
  /** Pending FK definitions registered via .references() on a helper column. */
  readonly pendingForeignKeys: object[];
  /** Pending Vector index definitions registered via .vectorIndex() on a helper column. */
  readonly pendingVectorIndexes: {
    column: string;
    options: VectorIndexOptions;
  }[];
  addPendingIndex(index: {
    columns: string[];
    unique?: boolean;
  }): void;
  addForeignKeyOperation(fk: object): void;
  addPendingVectorIndex(column: string, options: Omit<VectorIndexOptions, "column">): void;
}
/**
 * A `ColumnBuilder` that carries its own detached sink so it can be
 * constructed outside of a migration class and later merged in.
 */
declare class DetachedColumnBuilder extends ColumnBuilder {
  readonly sink: DetachedMigrationSink;
  constructor(type: ConstructorParameters<typeof ColumnBuilder>[2], name: string, options?: ConstructorParameters<typeof ColumnBuilder>[3]);
}
/**
 * Standalone column helper: string / varchar.
 *
 * @example
 * ```typescript
 * import { Migration, string } from "@warlock.js/cascade";
 *
 * export default Migration.create(User, {
 *   username: string(50).unique(),
 * });
 * ```
 */
declare function string(length?: number): DetachedColumnBuilder;
/**
 * Standalone column helper: fixed-length CHAR.
 *
 * @example
 * ```typescript
 * code: char(3) // CHAR(3)
 * ```
 */
declare function char(length: number): DetachedColumnBuilder;
/**
 * Standalone column helper: TEXT (unlimited length).
 *
 * @example
 * ```typescript
 * import { Migration, text } from "@warlock.js/cascade";
 *
 * export default Migration.create(User, {
 *   bio: text().nullable(),
 * });
 * ```
 */
declare function text(): DetachedColumnBuilder;
/**
 * Standalone column helper: MEDIUMTEXT.
 */
declare function mediumText(): DetachedColumnBuilder;
/**
 * Standalone column helper: LONGTEXT.
 */
declare function longText(): DetachedColumnBuilder;
/**
 * Standalone column helper: INTEGER.
 *
 * @example
 * ```typescript
 * age: integer().unsigned()
 * ```
 */
declare function integer(): DetachedColumnBuilder;
/** Alias for `integer()`. */
declare const int: typeof integer;
/**
 * Standalone column helper: SMALLINT.
 */
declare function smallInteger(): DetachedColumnBuilder;
/** Alias for `smallInteger()`. */
declare const smallInt: typeof smallInteger;
/**
 * Standalone column helper: TINYINT.
 */
declare function tinyInteger(): DetachedColumnBuilder;
/** Alias for `tinyInteger()`. */
declare const tinyInt: typeof tinyInteger;
/**
 * Standalone column helper: BIGINT.
 */
declare function bigInteger(): DetachedColumnBuilder;
/** Alias for `bigInteger()`. */
declare const bigInt: typeof bigInteger;
/**
 * Standalone column helper: FLOAT.
 */
declare function float(): DetachedColumnBuilder;
/**
 * Standalone column helper: DOUBLE.
 */
declare function double(): DetachedColumnBuilder;
/**
 * Standalone column helper: DECIMAL.
 *
 * @example
 * ```typescript
 * price: decimal(10, 2) // DECIMAL(10,2)
 * ```
 */
declare function decimal(precision?: number, scale?: number): DetachedColumnBuilder;
/**
 * Standalone column helper: BOOLEAN.
 *
 * Named `boolCol` to avoid collision with the TypeScript / JS `boolean` primitive.
 *
 * @example
 * ```typescript
 * is_active: boolCol().default(true)
 * ```
 */
declare function boolCol(): DetachedColumnBuilder;
/**
 * Standalone column helper: DATE.
 */
declare function date(): DetachedColumnBuilder;
/**
 * Standalone column helper: DATETIME.
 */
declare function dateTime(): DetachedColumnBuilder;
/**
 * Standalone column helper: TIMESTAMP.
 *
 * @example
 * ```typescript
 * started_at: timestamp().default("NOW()")
 * ```
 */
declare function timestamp(): DetachedColumnBuilder;
/**
 * Standalone column helper: TIME.
 */
declare function time(): DetachedColumnBuilder;
/**
 * Standalone column helper: YEAR.
 */
declare function year(): DetachedColumnBuilder;
/**
 * Standalone column helper: JSON.
 *
 * Named `jsonCol` to avoid collision with the TS/JSON built-in names.
 * Use `json()` is fine for most cases though — this alias exists for clarity.
 *
 * @example
 * ```typescript
 * metadata: json().nullable()
 * ```
 */
declare function json(): DetachedColumnBuilder;
/**
 * Alias for `json()`. Named `objectCol` to avoid collision with TS `object` type.
 */
declare function objectCol(): DetachedColumnBuilder;
/**
 * Standalone column helper: BINARY / BLOB.
 */
declare function binary(): DetachedColumnBuilder;
/**
 * Alias for `binary()`. Named `blobCol` to avoid collision with the Web `Blob` API.
 */
declare function blobCol(): DetachedColumnBuilder;
/**
 * Standalone column helper: UUID.
 *
 * @example
 * ```typescript
 * import { Migration, uuid } from "@warlock.js/cascade";
 *
 * export default Migration.create(Chat, {
 *   organization_id: uuid().references(Organization).onDelete("cascade"),
 * });
 * ```
 */
declare function uuid(): DetachedColumnBuilder;
/**
 * Standalone column helper: ULID.
 */
declare function ulid(): DetachedColumnBuilder;
/**
 * Standalone column helper: IP address.
 */
declare function ipAddress(): DetachedColumnBuilder;
/**
 * Standalone column helper: MAC address.
 */
declare function macAddress(): DetachedColumnBuilder;
/**
 * Standalone column helper: geo point.
 */
declare function point(): DetachedColumnBuilder;
/**
 * Standalone column helper: polygon.
 */
declare function polygon(): DetachedColumnBuilder;
/**
 * Standalone column helper: line string.
 */
declare function lineString(): DetachedColumnBuilder;
/**
 * Standalone column helper: generic geometry.
 */
declare function geometry(): DetachedColumnBuilder;
/**
 * Standalone column helper: vector (for AI embeddings).
 *
 * @param dimensions - Embedding size (e.g. 1536 for text-embedding-3-small)
 *
 * @example
 * ```typescript
 * embedding: vector(1536)
 * ```
 */
declare function vector(dimensions: number): DetachedColumnBuilder;
/**
 * Standalone column helper: ENUM.
 *
 * @example
 * ```typescript
 * status: enumCol(["active", "inactive", "pending"])
 * ```
 */
declare function enumCol(values: string[]): DetachedColumnBuilder;
/**
 * Standalone column helper: SET (multiple values).
 */
declare function setCol(values: string[]): DetachedColumnBuilder;
/** Standalone helper: INTEGER[] */
declare function arrayInt(): DetachedColumnBuilder;
/** Standalone helper: BIGINT[] */
declare function arrayBigInt(): DetachedColumnBuilder;
/** Standalone helper: REAL[] */
declare function arrayFloat(): DetachedColumnBuilder;
/** Standalone helper: DECIMAL[] */
declare function arrayDecimal(precision?: number, scale?: number): DetachedColumnBuilder;
/** Standalone helper: BOOLEAN[] */
declare function arrayBoolean(): DetachedColumnBuilder;
/** Standalone helper: TEXT[] */
declare function arrayText(): DetachedColumnBuilder;
/** Standalone helper: DATE[] */
declare function arrayDate(): DetachedColumnBuilder;
/** Standalone helper: TIMESTAMPTZ[] */
declare function arrayTimestamp(): DetachedColumnBuilder;
/** Standalone helper: UUID[] */
declare function arrayUuid(): DetachedColumnBuilder;
/** Standalone helper: JSONB[] */
declare function arrayJson(): DetachedColumnBuilder;
//#endregion
export { DetachedColumnBuilder, arrayBigInt, arrayBoolean, arrayDate, arrayDecimal, arrayFloat, arrayInt, arrayJson, arrayText, arrayTimestamp, arrayUuid, bigInt, bigInteger, binary, blobCol, boolCol, char, date, dateTime, decimal, double, enumCol, float, geometry, int, integer, ipAddress, json, lineString, longText, macAddress, mediumText, objectCol, point, polygon, setCol, smallInt, smallInteger, string, text, time, timestamp, tinyInt, tinyInteger, ulid, uuid, vector, year };
//# sourceMappingURL=column-helpers.d.mts.map