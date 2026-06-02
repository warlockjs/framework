//#region ../../@warlock.js/cascade/src/expressions/aggregate-expressions.ts
/**
* Checks if a value is an abstract aggregate expression.
*/
function isAggregateExpression(value) {
	return typeof value === "object" && value !== null && "__field" in value && typeof value.__agg === "string";
}
/**
* Database-agnostic aggregation expression helpers.
*
* These helpers create abstract expressions that each driver translates
* to their native format.
*/
const $agg = {
	/**
	* Count documents in each group.
	*
	* @returns Abstract count expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   count: $agg.count()
	* });
	* ```
	*
	* Translates to:
	* - MongoDB: `{ $sum: 1 }`
	* - SQL: `COUNT(*)`
	*/
	count() {
		return {
			__agg: "count",
			__field: null
		};
	},
	/**
	* Sum a numeric field across documents in each group.
	*
	* @param field - The field name to sum
	* @returns Abstract sum expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   totalDuration: $agg.sum("duration")
	* });
	* ```
	*
	* Translates to:
	* - MongoDB: `{ $sum: "$duration" }`
	* - SQL: `SUM(duration)`
	*/
	sum(field) {
		return {
			__agg: "sum",
			__field: field
		};
	},
	/**
	* Calculate the average value of a field across documents in each group.
	*
	* @param field - The field name to average
	* @returns Abstract average expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   avgRating: $agg.avg("rating")
	* });
	* ```
	*
	* Translates to:
	* - MongoDB: `{ $avg: "$rating" }`
	* - SQL: `AVG(rating)`
	*/
	avg(field) {
		return {
			__agg: "avg",
			__field: field
		};
	},
	/**
	* Get the minimum value of a field across documents in each group.
	*
	* @param field - The field name
	* @returns Abstract min expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   minPrice: $agg.min("price")
	* });
	* ```
	*
	* Translates to:
	* - MongoDB: `{ $min: "$price" }`
	* - SQL: `MIN(price)`
	*/
	min(field) {
		return {
			__agg: "min",
			__field: field
		};
	},
	/**
	* Get the maximum value of a field across documents in each group.
	*
	* @param field - The field name
	* @returns Abstract max expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   maxPrice: $agg.max("price")
	* });
	* ```
	*
	* Translates to:
	* - MongoDB: `{ $max: "$price" }`
	* - SQL: `MAX(price)`
	*/
	max(field) {
		return {
			__agg: "max",
			__field: field
		};
	},
	/**
	* Get the distinct values of a field across documents in each group.
	*
	* @param field - The field name
	* @returns Abstract distinct expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   distinctColors: $agg.distinct("color")
	* });
	* ```
	*
	* **MongoDB-only.** MongoDB: `{ $distinct: "$color" }` (returns the array
	* of distinct values). On Postgres this throws — SQL `DISTINCT` is a set
	* quantifier, not a scalar aggregate, so there is no equivalent single
	* value to put in a `GROUP BY` projection. Use `selectRaw` if you need a
	* Postgres-specific shape (e.g. `array_agg(DISTINCT color)`).
	*/
	distinct(field) {
		return {
			__agg: "distinct",
			__field: field
		};
	},
	/**
	* Get the floor value of a field across documents in each group.
	*
	* @param field - The field name
	* @returns Abstract floor expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   floorPrice: $agg.floor("price")
	* });
	* ```
	*
	* **MongoDB-only.** MongoDB: `{ $floor: "$price" }`. On Postgres this
	* throws — `FLOOR` is a scalar function, not an aggregate, so it is
	* meaningless inside a bare `$group` / `GROUP BY`. Use `selectRaw` with
	* `FLOOR(...)` over the aggregated value if you need it on Postgres.
	*/
	floor(field) {
		return {
			__agg: "floor",
			__field: field
		};
	},
	/**
	* Get the first value of a field in each group (order-dependent).
	*
	* @param field - The field name
	* @returns Abstract first expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   firstName: $agg.first("name")
	* });
	* ```
	*
	* **MongoDB-only.** MongoDB: `{ $first: "$name" }` (group-order
	* dependent). On Postgres this throws — the SQL equivalent is
	* `FIRST_VALUE(name) OVER (ORDER BY ...)`, a window function needing an
	* ordering context the `$agg` API doesn't carry. Use `selectRaw` with an
	* explicit window function if you need it on Postgres.
	*/
	first(field) {
		return {
			__agg: "first",
			__field: field
		};
	},
	/**
	* Get the last value of a field in each group (order-dependent).
	*
	* @param field - The field name
	* @returns Abstract last expression
	*
	* @example
	* ```typescript
	* query.groupBy("type", {
	*   lastName: $agg.last("name")
	* });
	* ```
	*
	* **MongoDB-only.** MongoDB: `{ $last: "$name" }` (group-order
	* dependent). On Postgres this throws — the SQL equivalent is
	* `LAST_VALUE(name) OVER (ORDER BY ...)`, a window function needing an
	* ordering context the `$agg` API doesn't carry. Use `selectRaw` with an
	* explicit window function if you need it on Postgres.
	*/
	last(field) {
		return {
			__agg: "last",
			__field: field
		};
	}
};
//#endregion
export { $agg, isAggregateExpression };

//# sourceMappingURL=aggregate-expressions.mjs.map