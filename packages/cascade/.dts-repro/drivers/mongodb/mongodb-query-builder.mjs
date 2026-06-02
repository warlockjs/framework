import { databaseTransactionContext } from "../../context/database-transaction-context.mjs";
import { dataSourceRegistry } from "../../data-source/data-source-registry.mjs";
import { QueryBuilder } from "../../query-builder/query-builder.mjs";
import { MongoQueryOperations } from "./mongodb-query-operations.mjs";
import { MongoQueryParser } from "./mongodb-query-parser.mjs";
import { get } from "@mongez/reinforcements";
//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-query-builder.ts
/**
* MongoDB-specific query builder implementation using aggregation pipeline.
*/
var MongoQueryBuilder = class MongoQueryBuilder extends QueryBuilder {
	table;
	/**
	* Ordered list of operations to be converted to MongoDB aggregation pipeline.
	* Public to allow parser access. Uses MongoDB's own Operation type.
	*
	* NOTE: This shadows the base `operations: Op[]` field intentionally — the Mongo
	* Operation type carries an extra `stage` discriminator used by the pipeline assembler.
	*/
	operations = [];
	/**
	* Data source instance
	*/
	dataSource;
	/**
	* Lazy-loaded operations helper for constructing pipeline operations.
	*/
	_operationsHelper;
	hydrateCallback;
	fetchingCallback;
	hydratingCallback;
	fetchedCallback;
	/**
	* Create a new query builder for the given collection.
	* @param collection - The MongoDB collection to query
	*/
	constructor(table, dataSource) {
		super();
		this.table = table;
		this.dataSource = dataSource || dataSourceRegistry.get();
	}
	/**
	* Gets the operations helper instance, creating it if needed.
	* @returns The operations helper instance
	*/
	get operationsHelper() {
		if (!this._operationsHelper) this._operationsHelper = new MongoQueryOperations(this.operations);
		return this._operationsHelper;
	}
	/**
	* Get collection instance
	*/
	get collection() {
		return this.dataSource.driver.database.collection(this.table);
	}
	/**
	* Add hydrate callback function
	*/
	hydrate(callback) {
		this.hydrateCallback = callback;
		return this;
	}
	/**
	* Register a callback to be invoked before query execution
	* @returns Unsubscribe function to remove the callback
	*/
	onFetching(callback) {
		this.fetchingCallback = callback;
		return () => {
			this.fetchingCallback = void 0;
		};
	}
	/**
	* Register a callback to be invoked after records are fetched but before hydration
	* @returns Unsubscribe function to remove the callback
	*/
	onHydrating(callback) {
		this.hydratingCallback = callback;
		return () => {
			this.hydratingCallback = void 0;
		};
	}
	/**
	* Register a callback to be invoked after records are fetched and hydrated
	* @returns Unsubscribe function to remove the callback
	*/
	onFetched(callback) {
		this.fetchedCallback = callback;
		return () => {
			this.fetchedCallback = void 0;
		};
	}
	/**
	* Disable one or more global scopes for this query
	*/
	withoutGlobalScope(...scopeNames) {
		scopeNames.forEach((name) => this.disabledGlobalScopes.add(name));
		return this;
	}
	/**
	* Disable all global scopes for this query
	*/
	withoutGlobalScopes() {
		if (this.pendingGlobalScopes) this.pendingGlobalScopes.forEach((_, name) => {
			this.disabledGlobalScopes.add(name);
		});
		return this;
	}
	/**
	* Apply a local scope to this query
	*/
	scope(scopeName, ...args) {
		if (!this.availableLocalScopes) throw new Error(`No local scopes available`);
		const scopeCallback = this.availableLocalScopes.get(scopeName);
		if (!scopeCallback) throw new Error(`Local scope "${scopeName}" not found`);
		scopeCallback(this, ...args);
		return this;
	}
	/**
	* Apply pending global scopes before query execution
	*/
	applyPendingScopes() {
		if (!this.pendingGlobalScopes || this.scopesApplied) return;
		const beforeOps = [];
		const afterOps = [];
		for (const [name, { callback, timing }] of this.pendingGlobalScopes) {
			if (this.disabledGlobalScopes.has(name)) continue;
			const tempBuilder = new MongoQueryBuilder(this.table, this.dataSource);
			callback(tempBuilder);
			if (timing === "before") beforeOps.push(...tempBuilder.operations);
			else afterOps.push(...tempBuilder.operations);
		}
		this.operations = [
			...beforeOps,
			...this.operations,
			...afterOps
		];
		this.scopesApplied = true;
	}
	where(...args) {
		this.addWhereClause("where", args);
		return this;
	}
	orWhere(...args) {
		this.addWhereClause("orWhere", args);
		return this;
	}
	/**
	* Adds a raw WHERE clause using MongoDB's native query syntax.
	* @param expression - Raw MongoDB expression
	* @param bindings - Optional parameter bindings for string expressions
	*/
	whereRaw(expression, bindings) {
		return this.addRawWhere("whereRaw", expression, bindings);
	}
	/**
	* Adds a raw OR WHERE clause using MongoDB's native query syntax.
	* @param expression - Raw MongoDB expression
	* @param bindings - Optional parameter bindings
	*/
	orWhereRaw(expression, bindings) {
		return this.addRawWhere("orWhereRaw", expression, bindings);
	}
	/**
	* Adds a WHERE clause comparing two columns/fields directly.
	* @param first - The first field name
	* @param operator - The comparison operator
	* @param second - The second field name
	*/
	whereColumn(first, operator, second) {
		this.operationsHelper.addMatchOperation("whereColumn", {
			first,
			operator,
			second
		});
		return this;
	}
	/**
	* Adds an OR WHERE clause comparing two columns/fields directly.
	* @param first - The first field name
	* @param operator - The comparison operator
	* @param second - The second field name
	*/
	orWhereColumn(first, operator, second) {
		this.operationsHelper.addMatchOperation("orWhereColumn", {
			first,
			operator,
			second
		});
		return this;
	}
	/**
	* Adds multiple column comparison clauses at once.
	* @param comparisons - Array of tuples [leftField, operator, rightField]
	*/
	whereColumns(comparisons) {
		for (const [left, operator, right] of comparisons) this.whereColumn(left, operator, right);
		return this;
	}
	/**
	* Filters documents where a field's value falls between two other fields.
	* @param field - The field to check
	* @param lowerColumn - The field defining the lower bound
	* @param upperColumn - The field defining the upper bound
	*/
	whereBetweenColumns(field, lowerColumn, upperColumn) {
		this.operationsHelper.addMatchOperation("whereBetweenColumns", {
			field,
			lowerColumn,
			upperColumn
		});
		return this;
	}
	/**
	* Filters documents where a date field matches the given date (ignoring time).
	* @param field - The date field name
	* @param value - The date to match
	*/
	whereDate(field, value) {
		this.operationsHelper.addMatchOperation("whereDate", {
			field,
			value
		});
		return this;
	}
	/**
	* Alias for `whereDate()`. Filters by exact date match (ignoring time).
	* @param field - The date field name
	* @param value - The date to match
	*/
	whereDateEquals(field, value) {
		this.operationsHelper.addMatchOperation("whereDateEquals", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where a date field is before the given date.
	* @param field - The date field name
	* @param value - The cutoff date
	*/
	whereDateBefore(field, value) {
		this.operationsHelper.addMatchOperation("whereDateBefore", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where a date field is after the given date.
	* @param field - The date field name
	* @param value - The cutoff date
	*/
	whereDateAfter(field, value) {
		this.operationsHelper.addMatchOperation("whereDateAfter", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where a time field matches the given time (HH:MM:SS format).
	* @param field - The time/datetime field name
	* @param value - The time string in HH:MM:SS format
	*/
	whereTime(field, value) {
		this.operationsHelper.addMatchOperation("whereTime", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where the day of the month matches the given value (1-31).
	* @param field - The date field name
	* @param value - The day of the month
	*/
	whereDay(field, value) {
		this.operationsHelper.addMatchOperation("whereDay", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where the month matches the given value (1-12).
	* @param field - The date field name
	* @param value - The month number
	*/
	whereMonth(field, value) {
		this.operationsHelper.addMatchOperation("whereMonth", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where the year matches the given value.
	* @param field - The date field name
	* @param value - The year
	*/
	whereYear(field, value) {
		this.operationsHelper.addMatchOperation("whereYear", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where a JSON field contains the specified value.
	* @param path - The JSON path to check
	* @param value - The value to search for
	*/
	whereJsonContains(path, value) {
		this.operationsHelper.addMatchOperation("whereJsonContains", {
			path,
			value
		});
		return this;
	}
	/**
	* Filters documents where a JSON field does NOT contain the specified value.
	* @param path - The JSON path to check
	* @param value - The value to exclude
	*/
	whereJsonDoesntContain(path, value) {
		this.operationsHelper.addMatchOperation("whereJsonDoesntContain", {
			path,
			value
		});
		return this;
	}
	/**
	* Filters documents where a JSON field contains a specific key.
	* @param path - The JSON path to check for key existence
	*/
	whereJsonContainsKey(path) {
		this.operationsHelper.addMatchOperation("whereJsonContainsKey", { path });
		return this;
	}
	/**
	* Filters documents where a JSON array or string has a specific length.
	* @param path - The JSON path to check
	* @param operator - The comparison operator
	* @param value - The length value to compare against
	*/
	whereJsonLength(path, operator, value) {
		this.operationsHelper.addMatchOperation("whereJsonLength", {
			path,
			operator,
			value
		});
		return this;
	}
	/**
	* Filters documents where a JSON field is an array.
	* @param path - The JSON path to check
	*/
	whereJsonIsArray(path) {
		this.operationsHelper.addMatchOperation("whereJsonIsArray", { path });
		return this;
	}
	/**
	* Filters documents where a JSON field is an object.
	* @param path - The JSON path to check
	*/
	whereJsonIsObject(path) {
		this.operationsHelper.addMatchOperation("whereJsonIsObject", { path });
		return this;
	}
	/**
	* Filters documents where an array field has a specific length.
	* @param field - The array field name
	* @param operator - The comparison operator
	* @param value - The length value to compare against
	*/
	whereArrayLength(field, operator, value) {
		this.operationsHelper.addMatchOperation("whereArrayLength", {
			field,
			operator,
			value
		});
		return this;
	}
	/**
	* Filters documents by ID (convenience method for `where("id", value)`).
	* @param value - The ID value to match
	*/
	whereId(value) {
		return this.where("id", value);
	}
	/**
	* Filters documents by multiple IDs (convenience method for `whereIn("id", values)`).
	* @param values - Array of ID values to match
	*/
	whereIds(values) {
		return this.whereIn("id", values);
	}
	/**
	* Filters documents by UUID (convenience method for `where("uuid", value)`).
	* @param value - The UUID string to match
	*/
	whereUuid(value) {
		return this.where("uuid", value);
	}
	/**
	* Filters documents by ULID (convenience method for `where("ulid", value)`).
	* @param value - The ULID string to match
	*/
	whereUlid(value) {
		return this.where("ulid", value);
	}
	/**
	* Performs full-text search on one or more fields.
	* @param fields - Field name or array of field names to search
	* @param query - The search query string
	*/
	whereFullText(fields, query) {
		const filters = typeof fields === "string" ? { fields: [fields] } : { fields: fields ?? [] };
		this.operationsHelper.addMatchOperation("whereFullText", {
			fields: filters.fields,
			query
		});
		return this;
	}
	/**
	* Performs full-text search with OR logic.
	* @param fields - Field name or array of field names to search
	* @param query - The search query string
	*/
	orWhereFullText(fields, query) {
		const filters = typeof fields === "string" ? { fields: [fields] } : { fields: fields ?? [] };
		this.operationsHelper.addMatchOperation("orWhereFullText", {
			fields: filters.fields,
			query
		});
		return this;
	}
	/**
	* Alias for `whereFullText()` with a single field.
	* @param field - The field name to search
	* @param query - The search query string
	*/
	whereSearch(field, query) {
		return this.whereFullText(field, query);
	}
	/**
	* Negates a set of conditions using a callback.
	* @param callback - Callback function defining conditions to negate
	*/
	whereNot(callback) {
		this.operationsHelper.addMatchOperation("where:not", { callback });
		return this;
	}
	/**
	* Negates a set of conditions with OR logic.
	* @param callback - Callback function defining conditions to negate
	*/
	orWhereNot(callback) {
		this.operationsHelper.addMatchOperation("orWhere:not", { callback });
		return this;
	}
	/**
	* Filters documents where a field's value matches any value in the given array.
	* @param field - The field name to check
	* @param values - Array of values to match against
	*/
	whereIn(field, values) {
		this.operationsHelper.addMatchOperation("whereIn", {
			field,
			values
		});
		return this;
	}
	/**
	* Filters documents where a field's value does NOT match any value in the array.
	* @param field - The field name to check
	* @param values - Array of values to exclude
	*/
	whereNotIn(field, values) {
		this.operationsHelper.addMatchOperation("whereNotIn", {
			field,
			values
		});
		return this;
	}
	/**
	* Filters documents where a field's value is null or undefined.
	* @param field - The field name to check
	*/
	whereNull(field) {
		this.operationsHelper.addMatchOperation("whereNull", { field });
		return this;
	}
	/**
	* Filters documents where a field's value is NOT null or undefined.
	* @param field - The field name to check
	*/
	whereNotNull(field) {
		this.operationsHelper.addMatchOperation("whereNotNull", { field });
		return this;
	}
	/**
	* Filters documents where a field's value falls within the given range (inclusive).
	* @param field - The field name to check
	* @param range - Tuple of [min, max] values
	*/
	whereBetween(field, range) {
		this.operationsHelper.addMatchOperation("whereBetween", {
			field,
			range
		});
		return this;
	}
	/**
	* Filters documents where a field's value is NOT within the given range.
	* @param field - The field name to check
	* @param range - Tuple of [min, max] values to exclude
	*/
	whereNotBetween(field, range) {
		this.operationsHelper.addMatchOperation("whereNotBetween", {
			field,
			range
		});
		return this;
	}
	/**
	* Filters documents where a field matches the given pattern (case-insensitive).
	* @param field - The field name to search
	* @param pattern - The pattern to match
	*/
	whereLike(field, pattern) {
		this.operationsHelper.addMatchOperation("whereLike", {
			field,
			pattern
		});
		return this;
	}
	/**
	* Filters documents where a field does NOT match the given pattern.
	* @param field - The field name to search
	* @param pattern - The pattern to exclude
	*/
	whereNotLike(field, pattern) {
		this.operationsHelper.addMatchOperation("whereNotLike", {
			field,
			pattern
		});
		return this;
	}
	/**
	* Filters documents where a field's value starts with the given prefix.
	* @param field - The field name to check
	* @param value - The prefix to match
	*/
	whereStartsWith(field, value) {
		this.operationsHelper.addMatchOperation("whereStartsWith", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where a field's value does NOT start with the given prefix.
	* @param field - The field name to check
	* @param value - The prefix to exclude
	*/
	whereNotStartsWith(field, value) {
		this.operationsHelper.addMatchOperation("whereNotStartsWith", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where a field's value ends with the given suffix.
	* @param field - The field name to check
	* @param value - The suffix to match
	*/
	whereEndsWith(field, value) {
		this.operationsHelper.addMatchOperation("whereEndsWith", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where a field's value does NOT end with the given suffix.
	* @param field - The field name to check
	* @param value - The suffix to exclude
	*/
	whereNotEndsWith(field, value) {
		this.operationsHelper.addMatchOperation("whereNotEndsWith", {
			field,
			value
		});
		return this;
	}
	/**
	* Filters documents where a date field falls within the given date range.
	* @param field - The date field name
	* @param range - Tuple of [startDate, endDate]
	*/
	whereDateBetween(field, range) {
		this.operationsHelper.addMatchOperation("whereDateBetween", {
			field,
			range
		});
		return this;
	}
	/**
	* Filters documents where a date field is NOT within the given date range.
	* @param field - The date field name
	* @param range - Tuple of [startDate, endDate] to exclude
	*/
	whereDateNotBetween(field, range) {
		this.operationsHelper.addMatchOperation("whereDateNotBetween", {
			field,
			range
		});
		return this;
	}
	whereExists(param) {
		if (typeof param === "function") {
			this.operationsHelper.addMatchOperation("where:exists", { callback: param });
			return this;
		}
		this.operationsHelper.addMatchOperation("whereExists", { field: param });
		return this;
	}
	whereNotExists(param) {
		if (typeof param === "function") {
			this.operationsHelper.addMatchOperation("where:notExists", { callback: param });
			return this;
		}
		this.operationsHelper.addMatchOperation("whereNotExists", { field: param });
		return this;
	}
	whereSize(field, ...args) {
		if (args.length === 1) this.operationsHelper.addMatchOperation("whereSize", {
			field,
			operator: "=",
			size: args[0]
		});
		else this.operationsHelper.addMatchOperation("whereSize", {
			field,
			operator: args[0],
			size: args[1]
		});
		return this;
	}
	/**
	* Performs a full-text search on the specified fields.
	* @param query - The search query string
	* @param filters - Optional additional filter conditions
	*/
	textSearch(query, filters) {
		this.operationsHelper.addMatchOperation("textSearch", {
			query,
			filters
		});
		return this;
	}
	/**
	* Filters documents where an array field contains the given value.
	* @param field - The array field name
	* @param value - The value to search for in the array
	* @param key - Optional key to check within array objects
	*/
	whereArrayContains(field, value, key) {
		this.operationsHelper.addMatchOperation("whereArrayContains", {
			field,
			value,
			key
		});
		return this;
	}
	/**
	* Filters documents where an array field does NOT contain the given value.
	* @param field - The array field name
	* @param value - The value to exclude from the array
	* @param key - Optional key to check within array objects
	*/
	whereArrayNotContains(field, value, key) {
		this.operationsHelper.addMatchOperation("whereArrayNotContains", {
			field,
			value,
			key
		});
		return this;
	}
	/**
	* Filters documents where an array field contains the value OR is empty.
	* @param field - The array field name
	* @param value - The value to search for
	* @param key - Optional key to check within array objects
	*/
	whereArrayHasOrEmpty(field, value, key) {
		this.operationsHelper.addMatchOperation("whereArrayHasOrEmpty", {
			field,
			value,
			key
		});
		return this;
	}
	/**
	* Filters documents where an array field does NOT contain the value AND is not empty.
	* @param field - The array field name
	* @param value - The value to exclude
	* @param key - Optional key to check within array objects
	*/
	whereArrayNotHaveOrEmpty(field, value, key) {
		this.operationsHelper.addMatchOperation("whereArrayNotHaveOrEmpty", {
			field,
			value,
			key
		});
		return this;
	}
	/**
	* Internal helper for processing where clause arguments.
	* @param prefix - The operation prefix
	* @param args - The arguments passed to where/orWhere
	*/
	addWhereClause(prefix, args) {
		if (args.length === 1) if (typeof args[0] === "function") this.operationsHelper.addMatchOperation(`${prefix}:callback`, args[0]);
		else this.operationsHelper.addMatchOperation(`${prefix}:object`, args[0]);
		else if (args.length === 2) this.operationsHelper.addMatchOperation(prefix, {
			field: args[0],
			operator: "=",
			value: args[1]
		});
		else if (args.length === 3) this.operationsHelper.addMatchOperation(prefix, {
			field: args[0],
			operator: args[1],
			value: args[2]
		});
	}
	/**
	* Internal helper for adding raw where clauses.
	* @param type - The operation type
	* @param expression - The raw expression in MongoDB query language
	* @param bindings - Optional bindings for the expression
	*/
	addRawWhere(type, expression, bindings) {
		this.operationsHelper.addMatchOperation(type, {
			expression,
			bindings
		});
		return this;
	}
	/**
	* Normalizes select field arguments into a structured format.
	* @param args - The arguments to normalize
	* @returns Normalized selection object with fields and aliases
	*/
	normalizeSelectFields(args) {
		if (args.length === 1) {
			const arg = args[0];
			if (typeof arg === "object" && !Array.isArray(arg)) return { projection: arg };
			if (Array.isArray(arg)) return { fields: arg };
			if (typeof arg === "string") return { fields: [arg] };
		}
		return { fields: args.filter((arg) => typeof arg === "string") };
	}
	select(...args) {
		const normalized = this.normalizeSelectFields(args);
		this.operationsHelper.addProjectOperation("select", normalized);
		return this;
	}
	/**
	* Selects a field with an alias.
	* @param field - The field to select
	* @param alias - The alias name for the field
	* @returns The query builder instance
	*/
	selectAs(field, alias) {
		return this.select({ [field]: alias });
	}
	/**
	* Adds a computed field using a raw MongoDB expression.
	* @param expression - The raw MongoDB expression
	* @param bindings - Optional parameter bindings for string expressions
	*/
	selectRaw(expression, bindings) {
		this.operationsHelper.addProjectOperation("selectRaw", {
			expression,
			bindings
		});
		return this;
	}
	/**
	* Adds multiple computed fields using raw MongoDB expressions.
	* @param definitions - Array of field definitions with alias, expression, and optional bindings
	*/
	selectRawMany(definitions) {
		for (const definition of definitions) this.selectRaw({ [definition.alias]: definition.expression }, definition.bindings);
		return this;
	}
	/**
	* Adds a subquery as a computed field.
	* @param expression - The subquery expression
	* @param alias - The alias for the computed field
	*/
	selectSub(expression, alias) {
		this.operationsHelper.addProjectOperation("selectSub", {
			expression,
			alias
		});
		return this;
	}
	/**
	* Adds an additional subquery field to existing selections.
	* @param expression - The subquery expression
	* @param alias - The alias for the computed field
	*/
	addSelectSub(expression, alias) {
		this.operationsHelper.addProjectOperation("addSelectSub", {
			expression,
			alias
		});
		return this;
	}
	/**
	* Adds an aggregate value as a computed field.
	* @param field - The field to aggregate
	* @param aggregate - The aggregate function to apply
	* @param alias - The alias for the computed field
	*/
	selectAggregate(field, aggregate, alias) {
		this.operationsHelper.addProjectOperation("selectAggregate", {
			field,
			aggregate,
			alias
		});
		return this;
	}
	/**
	* Adds a boolean field indicating whether a related document exists.
	* @param field - The field to check for existence
	* @param alias - The alias for the boolean field
	*/
	selectExists(field, alias) {
		this.operationsHelper.addProjectOperation("selectExists", {
			field,
			alias
		});
		return this;
	}
	/**
	* Adds a count field for a related collection.
	* @param field - The field to count
	* @param alias - The alias for the count field
	*/
	selectCount(field, alias) {
		this.operationsHelper.addProjectOperation("selectCount", {
			field,
			alias
		});
		return this;
	}
	/**
	* Adds a CASE-like conditional field using multiple conditions.
	* @param cases - Array of when/then pairs
	* @param otherwise - Default value if no conditions match
	* @param alias - The alias for the computed field
	*/
	selectCase(cases, otherwise, alias) {
		this.operationsHelper.addProjectOperation("selectCase", {
			cases,
			otherwise,
			alias
		});
		return this;
	}
	/**
	* Adds a simple conditional field (if/else).
	* @param condition - The condition to evaluate
	* @param thenValue - Value if condition is true
	* @param elseValue - Value if condition is false
	* @param alias - The alias for the computed field
	*/
	selectWhen(condition, thenValue, elseValue, alias) {
		this.operationsHelper.addProjectOperation("selectWhen", {
			condition,
			thenValue,
			elseValue,
			alias
		});
		return this;
	}
	/**
	* Allows direct manipulation of the MongoDB projection object.
	* @param callback - Function that receives and modifies the projection object
	*/
	selectDriverProjection(callback) {
		this.operationsHelper.addProjectOperation("selectDriverProjection", { callback });
		return this;
	}
	/**
	* Extracts a JSON field from a document.
	* @param path - The JSON path to extract
	* @param alias - Optional alias for the extracted field
	*/
	selectJson(path, alias) {
		this.operationsHelper.addProjectOperation("selectJson", {
			path,
			alias
		});
		return this;
	}
	/**
	* Extracts a JSON field using a raw MongoDB expression.
	* @param path - The JSON path
	* @param expression - The raw expression for extraction
	* @param alias - The alias for the extracted field
	*/
	selectJsonRaw(path, expression, alias) {
		this.operationsHelper.addProjectOperation("selectJsonRaw", {
			path,
			expression,
			alias
		});
		return this;
	}
	/**
	* Excludes a JSON path from the results.
	* @param path - The JSON path to exclude
	*/
	deselectJson(path) {
		this.operationsHelper.addProjectOperation("deselectJson", { path });
		return this;
	}
	/**
	* Concatenates multiple fields into a single string field.
	* @param fields - Array of fields or expressions to concatenate
	* @param alias - The alias for the concatenated field
	*/
	selectConcat(fields, alias) {
		this.operationsHelper.addProjectOperation("selectConcat", {
			fields,
			alias
		});
		return this;
	}
	/**
	* Returns the first non-null value from a list of fields.
	* @param fields - Array of fields to check
	* @param alias - The alias for the coalesced field
	*/
	selectCoalesce(fields, alias) {
		this.operationsHelper.addProjectOperation("selectCoalesce", {
			fields,
			alias
		});
		return this;
	}
	/**
	* Adds window function operations to the query.
	* @param spec - The window function specification
	*/
	selectWindow(spec) {
		this.operationsHelper.addOperation("$setWindowFields", "selectWindow", { spec }, false);
		return this;
	}
	deselect(...args) {
		const fields = this.normalizeSelectFields(args);
		this.operationsHelper.addProjectOperation("deselect", { fields });
		return this;
	}
	/**
	* Returns only distinct values for the specified fields.
	* @param fields - Optional field names to use for distinctness
	*/
	distinctValues(fields) {
		this.operationsHelper.addGroupOperation("distinct", { fields }, false);
		return this;
	}
	addSelect(...args) {
		const fields = this.normalizeSelectFields(args);
		this.operationsHelper.addProjectOperation("addSelect", { fields });
		return this;
	}
	/**
	* Removes all field selection restrictions.
	*/
	clearSelect() {
		this.operations = this.operations.filter((op) => op.stage !== "$project");
		return this;
	}
	/**
	* Alias for `clearSelect()`. Removes all field restrictions.
	*/
	selectAll() {
		return this.clearSelect();
	}
	/**
	* Alias for `clearSelect()`. Resets to default field selection.
	*/
	selectDefault() {
		return this.clearSelect();
	}
	orderBy(fieldOrFields, direction = "asc") {
		if (typeof fieldOrFields === "string") this.operationsHelper.addSortOperation("orderBy", {
			field: fieldOrFields,
			direction
		});
		else for (const [field, dir] of Object.entries(fieldOrFields)) this.operationsHelper.addSortOperation("orderBy", {
			field,
			direction: dir
		});
		return this;
	}
	/**
	* Orders the query results by a field in descending order.
	* @param field - The field name to sort by
	*/
	orderByDesc(field) {
		return this.orderBy(field, "desc");
	}
	/**
	* Orders the query results using a raw MongoDB sort expression.
	* @param expression - The raw MongoDB sort expression
	* @param bindings - Optional parameter bindings
	*/
	orderByRaw(expression, bindings) {
		this.operationsHelper.addSortOperation("orderByRaw", {
			expression,
			bindings
		});
		return this;
	}
	/**
	* Orders the query results randomly.
	*/
	orderByRandom(limit = 1e3) {
		this.operationsHelper.addSortOperation("orderByRandom", { limit }, false);
		return this;
	}
	/**
	* Orders results by a date field in descending order (newest first).
	* @param column - The date column to sort by
	*/
	latest(column = "createdAt") {
		return this.orderBy(column, "desc").get();
	}
	/**
	* Orders results by a date field in ascending order (oldest first).
	* @param column - The date column to sort by
	*/
	oldest(column = "createdAt") {
		return this.orderBy(column, "asc");
	}
	/**
	* Limits the number of documents returned by the query.
	* @param value - The maximum number of documents to return
	*/
	limit(value) {
		this.operationsHelper.addOperation("$limit", "limit", { value }, false);
		return this;
	}
	/**
	* Skips a specified number of documents in the query results.
	* @param value - The number of documents to skip
	*/
	skip(value) {
		this.operationsHelper.addOperation("$skip", "skip", { value }, false);
		return this;
	}
	/**
	* Alias for `skip()`. Skips a specified number of documents.
	* @param value - The number of documents to skip
	*/
	offset(value) {
		return this.skip(value);
	}
	/**
	* Alias for `limit()`. Limits the number of documents returned.
	* @param value - The maximum number of documents to return
	*/
	take(value) {
		return this.limit(value);
	}
	/**
	* Applies cursor-based filtering for pagination.
	* @param after - Cursor value for forward pagination
	* @param before - Cursor value for backward pagination
	*/
	cursor(after, before) {
		this.operationsHelper.addMatchOperation("cursor", {
			after,
			before
		});
		return this;
	}
	groupBy(fields, aggregates) {
		if (aggregates) this.operationsHelper.addGroupOperation("groupByWithAggregates", {
			fields,
			aggregates
		}, false);
		else this.operationsHelper.addGroupOperation("groupBy", { fields }, false);
		return this;
	}
	/**
	* Groups documents using a raw MongoDB expression.
	* @param expression - The raw grouping expression
	* @param bindings - Optional parameter bindings
	*/
	groupByRaw(expression, bindings) {
		this.operationsHelper.addGroupOperation("groupByRaw", {
			expression,
			bindings
		}, false);
		return this;
	}
	having(...args) {
		if (args.length === 1) this.operationsHelper.addMatchOperation("having:condition", args[0], false);
		else if (args.length === 2) this.operationsHelper.addMatchOperation("having", {
			field: args[0],
			operator: "=",
			value: args[1]
		}, false);
		else this.operationsHelper.addMatchOperation("having", {
			field: args[0],
			operator: args[1],
			value: args[2]
		}, false);
		return this;
	}
	/**
	* Filters grouped results using a raw MongoDB expression.
	* @param expression - The raw having expression
	* @param bindings - Optional parameter bindings
	*/
	havingRaw(expression, bindings) {
		this.operationsHelper.addMatchOperation("havingRaw", {
			expression,
			bindings
		}, false);
		return this;
	}
	join(tableOrOptions, localField, foreignField) {
		const options = typeof tableOrOptions === "string" ? {
			table: tableOrOptions,
			localField,
			foreignField,
			type: "left"
		} : tableOrOptions;
		this.operationsHelper.addLookupOperation("join", options);
		return this;
	}
	leftJoin(tableOrOptions, localField, foreignField) {
		const options = typeof tableOrOptions === "string" ? {
			table: tableOrOptions,
			localField,
			foreignField,
			type: "left"
		} : {
			...tableOrOptions,
			type: "left"
		};
		this.operationsHelper.addLookupOperation("join", options);
		return this;
	}
	rightJoin(tableOrOptions, localField, foreignField) {
		const options = typeof tableOrOptions === "string" ? {
			table: tableOrOptions,
			localField,
			foreignField,
			type: "right"
		} : {
			...tableOrOptions,
			type: "right"
		};
		this.operationsHelper.addLookupOperation("join", options);
		return this;
	}
	innerJoin(tableOrOptions, localField, foreignField) {
		const options = typeof tableOrOptions === "string" ? {
			table: tableOrOptions,
			localField,
			foreignField,
			type: "inner"
		} : {
			...tableOrOptions,
			type: "inner"
		};
		this.operationsHelper.addLookupOperation("join", options);
		return this;
	}
	fullJoin(tableOrOptions, localField, foreignField) {
		const options = typeof tableOrOptions === "string" ? {
			table: tableOrOptions,
			localField,
			foreignField,
			type: "full"
		} : {
			...tableOrOptions,
			type: "full"
		};
		this.operationsHelper.addLookupOperation("join", options);
		return this;
	}
	/**
	* Performs a cross join with another collection.
	*
	* This creates a cartesian product by using $lookup with empty matching criteria.
	*
	* @param table - Target collection name
	*/
	crossJoin(table) {
		this.operationsHelper.addLookupOperation("join", {
			table,
			localField: "_crossJoinDummy",
			foreignField: "_crossJoinDummy",
			type: "cross",
			pipeline: [{ $match: {} }]
		});
		return this;
	}
	/**
	* Performs a raw join using a custom aggregation pipeline.
	*
	* This allows full control over the $lookup stage for complex join scenarios.
	*
	* @param expression - Raw expression (typically a $lookup stage or pipeline)
	* @param _bindings - Optional bindings (not used in MongoDB but kept for API consistency)
	*/
	joinRaw(expression, _bindings) {
		this.operationsHelper.addMatchOperation("raw", { builder: () => expression }, false);
		return this;
	}
	/**
	* Allows direct manipulation of the native MongoDB query.
	* @param builder - Function that receives and modifies the native query
	*/
	raw(builder) {
		this.operationsHelper.addMatchOperation("raw", { builder }, false);
		return this;
	}
	/**
	* Extends the query builder with driver-specific functionality.
	* @param extension - The extension name
	* @param _args - Extension-specific arguments
	* @returns The extension's return value
	*/
	extend(extension, ..._args) {
		throw new Error(`Extension '${extension}' is not supported by MongoQueryBuilder`);
	}
	/**
	* Creates a deep copy of the query builder.
	* @returns A new query builder instance with copied operations
	*/
	clone() {
		const cloned = new MongoQueryBuilder(this.table, this.dataSource);
		cloned.operations = [...this.operations];
		cloned.hydrateCallback = this.hydrateCallback?.bind(cloned);
		cloned.fetchingCallback = this.fetchingCallback?.bind(cloned);
		cloned.hydratingCallback = this.hydratingCallback?.bind(cloned);
		cloned.fetchedCallback = this.fetchedCallback?.bind(cloned);
		cloned.pendingGlobalScopes = this.pendingGlobalScopes;
		cloned.availableLocalScopes = this.availableLocalScopes;
		cloned.disabledGlobalScopes = new Set(this.disabledGlobalScopes);
		cloned.scopesApplied = this.scopesApplied;
		cloned.__operationsHelper = this.__operationsHelper;
		return cloned;
	}
	/**
	* Executes a callback with the query builder without breaking the chain.
	* @param callback - Function to execute with the builder
	*/
	tap(callback) {
		callback(this);
		return this;
	}
	/**
	* Conditionally applies query modifications based on a condition.
	* @param condition - The condition to evaluate
	* @param callback - Function to execute if condition is true
	* @param otherwise - Optional function to execute if condition is false
	*
	* @example
	* query.when(searchTerm, (q, term) => q.whereLike('name', term))
	*/
	when(condition, callback, otherwise) {
		if (condition) callback(this, condition);
		else if (otherwise) otherwise(this);
		return this;
	}
	/**
	* Executes the query and returns all matching documents.
	* @returns an array of matching documents
	*/
	async get() {
		const startTime = Date.now();
		if (this.fetchingCallback) await this.fetchingCallback(this);
		const rawRecords = await this.execute();
		if (this.hydratingCallback) await this.hydratingCallback(rawRecords, {
			query: this,
			hydrateCallback: this.hydrateCallback
		});
		const hydratedRecords = this.hydrateCallback ? rawRecords.map(this.hydrateCallback) : rawRecords;
		if (this.fetchedCallback) await this.fetchedCallback(hydratedRecords, {
			query: this,
			rawRecords,
			duration: Date.now() - startTime
		});
		return hydratedRecords;
	}
	/**
	* Execute the query and get first result
	* This is different than `first` as first adds a `limit = 1` to the pipeline
	*/
	async getFirst() {
		return (await this.get())?.[0] ?? null;
	}
	/**
	* Executes the query and returns the first matching document.
	* @returns the first document or null
	*/
	async first() {
		const results = await this.limit(1).get();
		return results.length > 0 ? results[0] : null;
	}
	/**
	* Executes the query and returns the first matching document, throwing if none found.
	* @returns the first document
	*/
	async firstOrFail() {
		const result = await this.first();
		if (!result) throw new Error("No records found matching the query");
		return result;
	}
	/**
	* Find a document by its primary key (id field).
	*/
	async find(id) {
		return this.where("id", id).first();
	}
	/**
	* Configures the query to retrieve the last matching document.
	*/
	last(field = "createdAt") {
		this.orderBy(field, "desc");
		return this.first();
	}
	/**
	* Counts the number of documents matching the query.
	* @returns the count of matching documents
	*/
	async count() {
		const pipeline = this.buildPipeline();
		pipeline.push({ $count: "total" });
		const results = await this.execute(pipeline);
		return results.length > 0 ? results[0].total : 0;
	}
	/**
	* Calculates the sum of a numeric field across matching documents.
	* @param field - The numeric field to sum
	* @returns the sum value
	*/
	async sum(field) {
		this.groupByRaw({
			_id: null,
			total: { $sum: `$${field}` }
		});
		this.hydrateCallback = void 0;
		return (await this.getFirst())?.total ?? 0;
	}
	/**
	* Calculates the average value of a numeric field across matching documents.
	* @param field - The numeric field to average
	* @returns the average value
	*/
	async avg(field) {
		this.groupByRaw({
			_id: null,
			average: { $avg: `$${field}` }
		});
		this.hydrateCallback = void 0;
		return (await this.getFirst())?.average ?? 0;
	}
	/**
	* Finds the minimum value of a field across matching documents.
	* @param field - The field to find the minimum of
	* @returns the minimum value
	*/
	async min(field) {
		this.groupByRaw({
			_id: null,
			minimum: { $min: `$${field}` }
		});
		this.hydrateCallback = void 0;
		return (await this.getFirst())?.minimum ?? 0;
	}
	/**
	* Finds the maximum value of a field across matching documents.
	* @param field - The field to find the maximum of
	* @returns the maximum value
	*/
	async max(field) {
		this.groupByRaw({
			_id: null,
			maximum: { $max: `$${field}` }
		});
		this.hydrateCallback = void 0;
		return (await this.getFirst())?.maximum ?? 0;
	}
	/**
	* Returns an array of distinct values for a field, respecting query filters.
	* @param field - The field to get distinct values from
	* @returns an array of distinct values
	*/
	async distinct(field, ignoreNull = true) {
		if (ignoreNull) this.whereNotNull(field);
		this.groupBy(field);
		this.hydrateCallback = void 0;
		return (await this.get()).map((doc) => doc._id);
	}
	/**
	* Count distinct values for a field, respecting query filters.
	* @param field - The field to count distinct values for
	* @returns the count of distinct values
	*/
	async countDistinct(field, ignoreNull = true) {
		if (ignoreNull) this.whereNotNull(field);
		return await this.groupBy(field).count();
	}
	/**
	* Extracts a single field value from each matching document.
	* @param field - The field to extract
	* @returns an array of field values
	*/
	async pluck(field) {
		this.hydrateCallback = void 0;
		return (await this.selectAs(field, "value").get()).map((doc) => doc.value).filter((value) => value !== void 0);
	}
	/**
	* Gets the value of a single field from the first matching document.
	* @param field - The field to extract
	* @returns the field value or null
	*/
	async value(field) {
		this.hydrateCallback = void 0;
		return (await this.selectAs(field, "value").first())?.value ?? null;
	}
	/**
	* Checks if any documents match the query.
	* @param filter - Optional filter to apply to the query
	* @returns true if documents exist, false otherwise
	*/
	async exists(filter) {
		if (filter) this.where(filter);
		return await this.limit(1).count() > 0;
	}
	/**
	* Checks if no documents match the query.
	* @param filter - Optional filter to apply to the query
	* @returns true if no documents exist, false otherwise
	*/
	async notExists(filter) {
		return !await this.exists(filter);
	}
	/**
	* Increments a numeric field by the specified amount for first matching document.
	* @param field - The field to increment
	* @param amount - The amount to increment by (default: 1)
	* @returns the new value
	*/
	async increment(field, amount = 1) {
		const filter = this.buildFilter();
		return get(await this.collection.findOneAndUpdate(filter, { $inc: { [field]: amount } }, { returnDocument: "after" }), field, 0);
	}
	/**
	* Decrements a numeric field by the specified amount.
	* @param field - The field to decrement
	* @param amount - The amount to decrement by
	* @returns the new value
	*/
	async decrement(field, amount = 1) {
		return this.increment(field, -amount);
	}
	/**
	* Increments a numeric field by the specified amount for all matching documents.
	* @param field - The field to increment
	* @param amount - The amount to increment by (default: 1)
	* @returns the number of documents modified
	*/
	async incrementMany(field, amount = 1) {
		const filter = this.buildFilter();
		return (await this.dataSource.driver.updateMany(this.table, filter, { $inc: { [field]: amount } })).modifiedCount;
	}
	/**
	* Decrements a numeric field by the specified amount for all matching documents.
	* @param field - The field to decrement
	* @param amount - The amount to decrement by (default: 1)
	* @returns the number of documents modified
	*/
	async decrementMany(field, amount = 1) {
		return this.incrementMany(field, -amount);
	}
	/**
	* Delete all documents matching the query.
	*/
	async delete() {
		const filter = this.buildFilter();
		return await this.dataSource.driver.deleteMany(this.table, filter);
	}
	/**
	* Delete a single document matching the query.
	*/
	async deleteOne() {
		const filter = this.buildFilter();
		return await this.dataSource.driver.delete(this.table, filter);
	}
	/**
	* Update the given fields for all documents matching the query.
	*/
	async update(fields) {
		const filter = this.buildFilter();
		return (await this.dataSource.driver.updateMany(this.table, filter, { $set: fields })).modifiedCount;
	}
	/**
	* Unset the given fields from all documents matching the query.
	*/
	async unset(...fields) {
		const filter = this.buildFilter();
		return (await this.dataSource.driver.updateMany(this.table, filter, { $unset: fields.reduce((acc, field) => {
			acc[field] = 1;
			return acc;
		}, {}) })).modifiedCount;
	}
	/**
	* Processes query results in chunks, executing a callback for each chunk.
	* @param size - The number of documents per chunk
	* @param callback - Function to execute for each chunk
	* @returns void
	*/
	async chunk(size, callback) {
		let chunkIndex = 0;
		let hasMore = true;
		while (hasMore) {
			const chunk = await this.clone().skip(chunkIndex * size).limit(size).get();
			if (chunk.length === 0) break;
			if (await callback(chunk, chunkIndex) === false) break;
			hasMore = chunk.length === size;
			chunkIndex++;
		}
	}
	/**
	* Executes the query with traditional page-based pagination.
	* @param options - Pagination options
	* @returns pagination result with data and metadata
	*/
	async paginate(options) {
		const page = options?.page ?? 1;
		const limit = options?.limit ?? 10;
		const skip = (page - 1) * limit;
		const [data, total] = await Promise.all([this.clone().skip(skip).limit(limit).get(), this.count()]);
		return {
			data,
			pagination: {
				total,
				page,
				limit,
				pages: Math.ceil(total / limit)
			}
		};
	}
	/**
	* Executes the query with cursor-based pagination supporting both directions.
	* @param options - Cursor pagination options
	* @returns cursor pagination result with data and cursor info
	*/
	async cursorPaginate(options) {
		const limit = options?.limit ?? 10;
		const cursor = options?.cursor;
		const column = options?.column ?? "id";
		const direction = options?.direction ?? "next";
		if (cursor) {
			const operator = direction === "next" ? ">" : "<";
			this.where(column, operator, cursor);
		}
		const sortOrder = direction === "next" ? "asc" : "desc";
		this.orderBy(column, sortOrder);
		this.orderBy("_id", sortOrder);
		const results = await this.limit(limit + 1).get();
		const hasMore = results.length > limit;
		let data = hasMore ? results.slice(0, limit) : results;
		if (direction === "prev") data = data.reverse();
		let nextCursor;
		let prevCursor;
		let hasPrev = false;
		if (data.length > 0) {
			const firstItem = data[0][column];
			const lastItem = data[data.length - 1][column];
			if (direction === "next") {
				nextCursor = hasMore ? lastItem : void 0;
				if (cursor) {
					hasPrev = true;
					prevCursor = firstItem;
				}
			} else {
				prevCursor = hasMore ? firstItem : void 0;
				hasPrev = hasMore;
				if (cursor) nextCursor = lastItem;
			}
		}
		return {
			data,
			pagination: {
				hasMore,
				hasPrev,
				nextCursor,
				prevCursor
			}
		};
	}
	/**
	* Returns the MongoDB aggregation pipeline that will be executed.
	*/
	parse() {
		return { pipeline: this.buildPipeline() };
	}
	/**
	* Returns a formatted string representation of the query pipeline.
	* @returns A formatted string representation of the pipeline
	*/
	pretty() {
		return this.getParser().toPrettyString();
	}
	/**
	* Returns the MongoDB query execution plan.
	* @returns MongoDB's explain output
	*/
	async explain() {
		const pipeline = this.buildPipeline();
		const session = databaseTransactionContext.getSession();
		const options = session ? {
			session,
			explain: true
		} : { explain: true };
		return this.collection.aggregate(pipeline, options).toArray();
	}
	/**
	* Get query parser instance
	*/
	getParser() {
		this.applyPendingScopes();
		return new MongoQueryParser({
			collection: this.collection,
			operations: this.operations,
			createSubBuilder: () => new MongoQueryBuilder(this.table, this.dataSource)
		});
	}
	/**
	* Build the MongoDB aggregation pipeline from the operations list.
	* @returns The MongoDB aggregation pipeline
	*/
	buildPipeline() {
		return this.getParser().parse();
	}
	/**
	* Build a MongoDB filter object from the query's where clauses.
	* Used for update operations like increment/decrement.
	* @returns The MongoDB filter object
	*/
	buildFilter() {
		if (this.operations.filter((op) => op.stage === "$match").length === 0) return {};
		const matchStage = this.buildPipeline().find((stage) => stage.$match);
		if (matchStage && matchStage.$match) return matchStage.$match;
		return {};
	}
	/**
	* Execute the aggregate command
	*/
	async execute(pipeline) {
		const aggregationPipeline = pipeline || this.buildPipeline();
		const options = { session: databaseTransactionContext.getSession() };
		const results = await this.collection.aggregate(aggregationPipeline, options).toArray();
		this.operations = [];
		this.operationsHelper.setOperations(this.operations);
		return results;
	}
	/**
	* Relations to eagerly load.
	*/
	eagerLoadRelations = /* @__PURE__ */ new Map();
	/**
	* Relations to load via $lookup (single query).
	*/
	joinRelations = /* @__PURE__ */ new Map();
	/**
	* Load relations using MongoDB $lookup in a single aggregation query.
	*
	* Unlike `with()` which uses separate queries, `joinWith()` uses
	* $lookup to fetch related data in a single aggregation pipeline.
	*
	* @param relations - Relation names to load via $lookup
	* @returns This builder for chaining
	*/
	joinWith(...relations) {
		for (const relation of relations) {
			const def = this.relationDefinitions?.[relation];
			if (def) this.joinRelations.set(relation, {
				alias: `_rel_${relation}`,
				type: def.type
			});
		}
		return this;
	}
	/**
	* Eagerly load one or more relations.
	*
	* Supported patterns:
	* - `with("posts")` - Load relation
	* - `with("posts", "comments")` - Load multiple relations
	* - `with("posts", callback)` - Load relation with constraint
	* - `with({ posts: true, comments: callback })` - Object configuration
	*
	* @param args - Relation name(s), callbacks, or configuration object
	*/
	with(...args) {
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (typeof arg === "string") {
				const nextArg = args[i + 1];
				if (typeof nextArg === "function") {
					this.eagerLoadRelations.set(arg, nextArg);
					i++;
				} else this.eagerLoadRelations.set(arg, true);
			} else if (typeof arg === "object" && arg !== null) for (const [key, value] of Object.entries(arg)) this.eagerLoadRelations.set(key, value);
		}
		return this;
	}
	/**
	* Filter results to only those that have related models.
	* @param relation - Relation name
	* @param operator - Optional comparison operator
	* @param count - Optional count to compare against
	*/
	has(relation, operator, count) {
		this.operationsHelper.addMatchOperation("has", {
			relation,
			operator,
			count
		});
		return this;
	}
	/**
	* Filter results that have related models matching specific conditions.
	* @param relation - Relation name
	* @param callback - Callback to define conditions
	*/
	whereHas(relation, callback) {
		this.operationsHelper.addMatchOperation("whereHas", {
			relation,
			callback
		});
		return this;
	}
	/**
	* Filter results that don't have any related models.
	* @param relation - Relation name
	*/
	doesntHave(relation) {
		this.operationsHelper.addMatchOperation("doesntHave", { relation });
		return this;
	}
	/**
	* Filter results that don't have related models matching specific conditions.
	* @param relation - Relation name
	* @param callback - Callback to define conditions
	*/
	whereDoesntHave(relation, callback) {
		this.operationsHelper.addMatchOperation("whereDoesntHave", {
			relation,
			callback
		});
		return this;
	}
	/**
	* Nearest-neighbour vector similarity search via MongoDB Atlas $vectorSearch.
	*
	* Adds two pipeline stages:
	* 1. `$vectorSearch` — runs the ANN search using the Atlas vector index.
	*    Must be the first stage in the pipeline. Limit is embedded here.
	* 2. `$addFields` — exposes `{ $meta: "vectorSearchScore" }` under `alias`
	*    so callers can filter by minimum score after `.get()`.
	*
	* **Prerequisites:**
	* - MongoDB Atlas cluster (local/Community MongoDB does NOT support $vectorSearch)
	* - A vector search index on the collection, e.g.:
	*   `{ "fields": [{ "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" }] }`
	* - The index name convention used here is `"${column}_index"` (override via `alias` if needed).
	*
	* @param column    - Vector column name (e.g. `"embedding"`)
	* @param embedding - Query embedding as a plain number array
	* @param alias     - Score alias added to each result row (default: `"score"`)
	*
	* @example
	* ```typescript
	* const results = await Vector.query()
	*   .where({ organization_id: "org-123" })
	*   .similarTo("embedding", queryEmbedding)
	*   .limit(5)
	*   .get<VectorRow & { score: number }>();
	* ```
	*/
	similarTo(column, embedding, alias = "score") {
		const limit = this.operations.find((op) => op.type === "limit")?.data?.value ?? 10;
		this.operationsHelper.addOperation("$vectorSearch", "vectorSearch", {
			index: `${column}_index`,
			path: column,
			queryVector: embedding,
			numCandidates: limit * 10,
			limit
		}, false);
		this.operationsHelper.addOperation("$addFields", "vectorSearchScore", { [alias]: { $meta: "vectorSearchScore" } }, false);
		return this;
	}
};
//#endregion
export { MongoQueryBuilder };

//# sourceMappingURL=mongodb-query-builder.mjs.map