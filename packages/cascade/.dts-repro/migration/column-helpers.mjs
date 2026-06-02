import { ColumnBuilder } from "./column-builder.mjs";
//#region ../../@warlock.js/cascade/src/migration/column-helpers.ts
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
var DetachedMigrationSink = class {
	/** Pending indexes registered via .unique() / .index() on a helper column. */
	pendingIndexes = [];
	/** Pending FK definitions registered via .references() on a helper column. */
	pendingForeignKeys = [];
	/** Pending Vector index definitions registered via .vectorIndex() on a helper column. */
	pendingVectorIndexes = [];
	addPendingIndex(index) {
		this.pendingIndexes.push(index);
	}
	addForeignKeyOperation(fk) {
		this.pendingForeignKeys.push(fk);
	}
	addPendingVectorIndex(column, options) {
		this.pendingVectorIndexes.push({
			column,
			options
		});
	}
};
/**
* A `ColumnBuilder` that carries its own detached sink so it can be
* constructed outside of a migration class and later merged in.
*/
var DetachedColumnBuilder = class extends ColumnBuilder {
	sink;
	constructor(type, name, options = {}) {
		const sink = new DetachedMigrationSink();
		super(sink, name, type, options);
		this.sink = sink;
	}
};
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
function string(length = 255) {
	return new DetachedColumnBuilder("string", "__placeholder__", { length });
}
/**
* Standalone column helper: fixed-length CHAR.
*
* @example
* ```typescript
* code: char(3) // CHAR(3)
* ```
*/
function char(length) {
	return new DetachedColumnBuilder("char", "__placeholder__", { length });
}
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
function text() {
	return new DetachedColumnBuilder("text", "__placeholder__");
}
/**
* Standalone column helper: MEDIUMTEXT.
*/
function mediumText() {
	return new DetachedColumnBuilder("mediumText", "__placeholder__");
}
/**
* Standalone column helper: LONGTEXT.
*/
function longText() {
	return new DetachedColumnBuilder("longText", "__placeholder__");
}
/**
* Standalone column helper: INTEGER.
*
* @example
* ```typescript
* age: integer().unsigned()
* ```
*/
function integer() {
	return new DetachedColumnBuilder("integer", "__placeholder__");
}
/** Alias for `integer()`. */
const int = integer;
/**
* Standalone column helper: SMALLINT.
*/
function smallInteger() {
	return new DetachedColumnBuilder("smallInteger", "__placeholder__");
}
/** Alias for `smallInteger()`. */
const smallInt = smallInteger;
/**
* Standalone column helper: TINYINT.
*/
function tinyInteger() {
	return new DetachedColumnBuilder("tinyInteger", "__placeholder__");
}
/** Alias for `tinyInteger()`. */
const tinyInt = tinyInteger;
/**
* Standalone column helper: BIGINT.
*/
function bigInteger() {
	return new DetachedColumnBuilder("bigInteger", "__placeholder__");
}
/** Alias for `bigInteger()`. */
const bigInt = bigInteger;
/**
* Standalone column helper: FLOAT.
*/
function float() {
	return new DetachedColumnBuilder("float", "__placeholder__");
}
/**
* Standalone column helper: DOUBLE.
*/
function double() {
	return new DetachedColumnBuilder("double", "__placeholder__");
}
/**
* Standalone column helper: DECIMAL.
*
* @example
* ```typescript
* price: decimal(10, 2) // DECIMAL(10,2)
* ```
*/
function decimal(precision = 8, scale = 2) {
	return new DetachedColumnBuilder("decimal", "__placeholder__", {
		precision,
		scale
	});
}
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
function boolCol() {
	return new DetachedColumnBuilder("boolean", "__placeholder__");
}
/**
* Standalone column helper: DATE.
*/
function date() {
	return new DetachedColumnBuilder("date", "__placeholder__");
}
/**
* Standalone column helper: DATETIME.
*/
function dateTime() {
	return new DetachedColumnBuilder("dateTime", "__placeholder__");
}
/**
* Standalone column helper: TIMESTAMP.
*
* @example
* ```typescript
* started_at: timestamp().default("NOW()")
* ```
*/
function timestamp() {
	return new DetachedColumnBuilder("timestamp", "__placeholder__");
}
/**
* Standalone column helper: TIME.
*/
function time() {
	return new DetachedColumnBuilder("time", "__placeholder__");
}
/**
* Standalone column helper: YEAR.
*/
function year() {
	return new DetachedColumnBuilder("year", "__placeholder__");
}
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
function json() {
	return new DetachedColumnBuilder("json", "__placeholder__");
}
/**
* Alias for `json()`. Named `objectCol` to avoid collision with TS `object` type.
*/
function objectCol() {
	return new DetachedColumnBuilder("json", "__placeholder__");
}
/**
* Standalone column helper: BINARY / BLOB.
*/
function binary() {
	return new DetachedColumnBuilder("binary", "__placeholder__");
}
/**
* Alias for `binary()`. Named `blobCol` to avoid collision with the Web `Blob` API.
*/
function blobCol() {
	return new DetachedColumnBuilder("binary", "__placeholder__");
}
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
function uuid() {
	return new DetachedColumnBuilder("uuid", "__placeholder__");
}
/**
* Standalone column helper: ULID.
*/
function ulid() {
	return new DetachedColumnBuilder("ulid", "__placeholder__");
}
/**
* Standalone column helper: IP address.
*/
function ipAddress() {
	return new DetachedColumnBuilder("ipAddress", "__placeholder__");
}
/**
* Standalone column helper: MAC address.
*/
function macAddress() {
	return new DetachedColumnBuilder("macAddress", "__placeholder__");
}
/**
* Standalone column helper: geo point.
*/
function point() {
	return new DetachedColumnBuilder("point", "__placeholder__");
}
/**
* Standalone column helper: polygon.
*/
function polygon() {
	return new DetachedColumnBuilder("polygon", "__placeholder__");
}
/**
* Standalone column helper: line string.
*/
function lineString() {
	return new DetachedColumnBuilder("lineString", "__placeholder__");
}
/**
* Standalone column helper: generic geometry.
*/
function geometry() {
	return new DetachedColumnBuilder("geometry", "__placeholder__");
}
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
function vector(dimensions) {
	return new DetachedColumnBuilder("vector", "__placeholder__", { dimensions });
}
/**
* Standalone column helper: ENUM.
*
* @example
* ```typescript
* status: enumCol(["active", "inactive", "pending"])
* ```
*/
function enumCol(values) {
	return new DetachedColumnBuilder("enum", "__placeholder__", { values });
}
/**
* Standalone column helper: SET (multiple values).
*/
function setCol(values) {
	return new DetachedColumnBuilder("set", "__placeholder__", { values });
}
/** Standalone helper: INTEGER[] */
function arrayInt() {
	return new DetachedColumnBuilder("arrayInt", "__placeholder__");
}
/** Standalone helper: BIGINT[] */
function arrayBigInt() {
	return new DetachedColumnBuilder("arrayBigInt", "__placeholder__");
}
/** Standalone helper: REAL[] */
function arrayFloat() {
	return new DetachedColumnBuilder("arrayFloat", "__placeholder__");
}
/** Standalone helper: DECIMAL[] */
function arrayDecimal(precision, scale) {
	return new DetachedColumnBuilder("arrayDecimal", "__placeholder__", {
		precision,
		scale
	});
}
/** Standalone helper: BOOLEAN[] */
function arrayBoolean() {
	return new DetachedColumnBuilder("arrayBoolean", "__placeholder__");
}
/** Standalone helper: TEXT[] */
function arrayText() {
	return new DetachedColumnBuilder("arrayText", "__placeholder__");
}
/** Standalone helper: DATE[] */
function arrayDate() {
	return new DetachedColumnBuilder("arrayDate", "__placeholder__");
}
/** Standalone helper: TIMESTAMPTZ[] */
function arrayTimestamp() {
	return new DetachedColumnBuilder("arrayTimestamp", "__placeholder__");
}
/** Standalone helper: UUID[] */
function arrayUuid() {
	return new DetachedColumnBuilder("arrayUuid", "__placeholder__");
}
/** Standalone helper: JSONB[] */
function arrayJson() {
	return new DetachedColumnBuilder("arrayJson", "__placeholder__");
}
//#endregion
export { DetachedColumnBuilder, arrayBigInt, arrayBoolean, arrayDate, arrayDecimal, arrayFloat, arrayInt, arrayJson, arrayText, arrayTimestamp, arrayUuid, bigInt, bigInteger, binary, blobCol, boolCol, char, date, dateTime, decimal, double, enumCol, float, geometry, int, integer, ipAddress, json, lineString, longText, macAddress, mediumText, objectCol, point, polygon, setCol, smallInt, smallInteger, string, text, time, timestamp, tinyInt, tinyInteger, ulid, uuid, vector, year };

//# sourceMappingURL=column-helpers.mjs.map