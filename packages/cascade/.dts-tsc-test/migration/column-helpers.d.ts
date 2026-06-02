import { ColumnBuilder } from "./column-builder";
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
        options: import("../contracts/migration-driver.contract").VectorIndexOptions;
    }[];
    addPendingIndex(index: {
        columns: string[];
        unique?: boolean;
    }): void;
    addForeignKeyOperation(fk: object): void;
    addPendingVectorIndex(column: string, options: Omit<import("../contracts/migration-driver.contract").VectorIndexOptions, "column">): void;
}
/**
 * A `ColumnBuilder` that carries its own detached sink so it can be
 * constructed outside of a migration class and later merged in.
 */
export declare class DetachedColumnBuilder extends ColumnBuilder {
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
export declare function string(length?: number): DetachedColumnBuilder;
/**
 * Standalone column helper: fixed-length CHAR.
 *
 * @example
 * ```typescript
 * code: char(3) // CHAR(3)
 * ```
 */
export declare function char(length: number): DetachedColumnBuilder;
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
export declare function text(): DetachedColumnBuilder;
/**
 * Standalone column helper: MEDIUMTEXT.
 */
export declare function mediumText(): DetachedColumnBuilder;
/**
 * Standalone column helper: LONGTEXT.
 */
export declare function longText(): DetachedColumnBuilder;
/**
 * Standalone column helper: INTEGER.
 *
 * @example
 * ```typescript
 * age: integer().unsigned()
 * ```
 */
export declare function integer(): DetachedColumnBuilder;
/** Alias for `integer()`. */
export declare const int: typeof integer;
/**
 * Standalone column helper: SMALLINT.
 */
export declare function smallInteger(): DetachedColumnBuilder;
/** Alias for `smallInteger()`. */
export declare const smallInt: typeof smallInteger;
/**
 * Standalone column helper: TINYINT.
 */
export declare function tinyInteger(): DetachedColumnBuilder;
/** Alias for `tinyInteger()`. */
export declare const tinyInt: typeof tinyInteger;
/**
 * Standalone column helper: BIGINT.
 */
export declare function bigInteger(): DetachedColumnBuilder;
/** Alias for `bigInteger()`. */
export declare const bigInt: typeof bigInteger;
/**
 * Standalone column helper: FLOAT.
 */
export declare function float(): DetachedColumnBuilder;
/**
 * Standalone column helper: DOUBLE.
 */
export declare function double(): DetachedColumnBuilder;
/**
 * Standalone column helper: DECIMAL.
 *
 * @example
 * ```typescript
 * price: decimal(10, 2) // DECIMAL(10,2)
 * ```
 */
export declare function decimal(precision?: number, scale?: number): DetachedColumnBuilder;
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
export declare function boolCol(): DetachedColumnBuilder;
/** Alias for `boolCol()`. */
export { boolCol as bool };
/**
 * Standalone column helper: DATE.
 */
export declare function date(): DetachedColumnBuilder;
/**
 * Standalone column helper: DATETIME.
 */
export declare function dateTime(): DetachedColumnBuilder;
/**
 * Standalone column helper: TIMESTAMP.
 *
 * @example
 * ```typescript
 * started_at: timestamp().default("NOW()")
 * ```
 */
export declare function timestamp(): DetachedColumnBuilder;
/**
 * Standalone column helper: TIME.
 */
export declare function time(): DetachedColumnBuilder;
/**
 * Standalone column helper: YEAR.
 */
export declare function year(): DetachedColumnBuilder;
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
export declare function json(): DetachedColumnBuilder;
/**
 * Alias for `json()`. Named `objectCol` to avoid collision with TS `object` type.
 */
export declare function objectCol(): DetachedColumnBuilder;
/**
 * Standalone column helper: BINARY / BLOB.
 */
export declare function binary(): DetachedColumnBuilder;
/**
 * Alias for `binary()`. Named `blobCol` to avoid collision with the Web `Blob` API.
 */
export declare function blobCol(): DetachedColumnBuilder;
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
export declare function uuid(): DetachedColumnBuilder;
/**
 * Standalone column helper: ULID.
 */
export declare function ulid(): DetachedColumnBuilder;
/**
 * Standalone column helper: IP address.
 */
export declare function ipAddress(): DetachedColumnBuilder;
/**
 * Standalone column helper: MAC address.
 */
export declare function macAddress(): DetachedColumnBuilder;
/**
 * Standalone column helper: geo point.
 */
export declare function point(): DetachedColumnBuilder;
/**
 * Standalone column helper: polygon.
 */
export declare function polygon(): DetachedColumnBuilder;
/**
 * Standalone column helper: line string.
 */
export declare function lineString(): DetachedColumnBuilder;
/**
 * Standalone column helper: generic geometry.
 */
export declare function geometry(): DetachedColumnBuilder;
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
export declare function vector(dimensions: number): DetachedColumnBuilder;
/**
 * Standalone column helper: ENUM.
 *
 * @example
 * ```typescript
 * status: enumCol(["active", "inactive", "pending"])
 * ```
 */
export declare function enumCol(values: string[]): DetachedColumnBuilder;
/**
 * Standalone column helper: SET (multiple values).
 */
export declare function setCol(values: string[]): DetachedColumnBuilder;
/** Standalone helper: INTEGER[] */
export declare function arrayInt(): DetachedColumnBuilder;
/** Standalone helper: BIGINT[] */
export declare function arrayBigInt(): DetachedColumnBuilder;
/** Standalone helper: REAL[] */
export declare function arrayFloat(): DetachedColumnBuilder;
/** Standalone helper: DECIMAL[] */
export declare function arrayDecimal(precision?: number, scale?: number): DetachedColumnBuilder;
/** Standalone helper: BOOLEAN[] */
export declare function arrayBoolean(): DetachedColumnBuilder;
/** Standalone helper: TEXT[] */
export declare function arrayText(): DetachedColumnBuilder;
/** Standalone helper: DATE[] */
export declare function arrayDate(): DetachedColumnBuilder;
/** Standalone helper: TIMESTAMPTZ[] */
export declare function arrayTimestamp(): DetachedColumnBuilder;
/** Standalone helper: UUID[] */
export declare function arrayUuid(): DetachedColumnBuilder;
/** Standalone helper: JSONB[] */
export declare function arrayJson(): DetachedColumnBuilder;
//# sourceMappingURL=column-helpers.d.ts.map