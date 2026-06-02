import { isEmpty } from "@mongez/supportive-is";
//#region ../../@warlock.js/core/src/repositories/adapters/cascade/filter-applicator.ts
/**
* Applies repository filters to a Cascade-Next query builder
* Translates repository filter rules into Cascade query builder method calls
*/
var FilterApplicator = class {
	/**
	* Apply filters to a Cascade query builder
	*
	* @param query - Cascade query builder instance
	* @param filters - Filter structure defining how to filter
	* @param data - Data containing filter values
	* @param options - Additional filter options (date formats, etc.)
	*/
	apply(query, filters, data, options) {
		for (const key in filters) {
			const value = data[key];
			if (value === void 0) continue;
			const rule = this.parseFilterRule(key, filters[key]);
			this.applyFilterRule(query, rule, value, data, options);
		}
	}
	/**
	* Parse a filter rule into a structured format
	*/
	parseFilterRule(key, rule) {
		if (typeof rule === "function") return {
			type: "function",
			fn: rule,
			column: key
		};
		if (Array.isArray(rule)) {
			const [operator, target] = rule;
			if (target === void 0) return {
				type: operator,
				column: key,
				columns: void 0
			};
			if (Array.isArray(target)) return {
				type: operator,
				column: void 0,
				columns: target
			};
			return {
				type: operator,
				column: target,
				columns: void 0
			};
		}
		return {
			type: rule,
			column: key,
			columns: void 0
		};
	}
	/**
	* Apply a single filter rule to the query
	*/
	applyFilterRule(query, rule, value, data, options) {
		if (rule.type === "function") {
			rule.fn(value, query, data);
			return;
		}
		const handler = this.getFilterHandler(rule.type);
		if (handler) {
			handler.call(this, query, rule.column, rule.columns, value, options);
			return;
		}
		this.applyWhereOperator(query, rule.type, rule.column, rule.columns, value);
	}
	/**
	* Get filter handler for predefined types
	*/
	getFilterHandler(type) {
		return {
			bool: this.handleBoolean,
			boolean: this.handleBoolean,
			int: this.handleInt,
			integer: this.handleInt,
			"!int": this.handleNotInt,
			"int>": (q, col, cols, val) => this.handleIntComparison(q, col, cols, val, ">"),
			"int>=": (q, col, cols, val) => this.handleIntComparison(q, col, cols, val, ">="),
			"int<": (q, col, cols, val) => this.handleIntComparison(q, col, cols, val, "<"),
			"int<=": (q, col, cols, val) => this.handleIntComparison(q, col, cols, val, "<="),
			inInt: this.handleInInt,
			number: this.handleNumber,
			inNumber: this.handleInNumber,
			float: this.handleFloat,
			double: this.handleFloat,
			inFloat: this.handleInNumber,
			null: this.handleNull,
			notNull: this.handleNotNull,
			"!null": this.handleNotNull,
			date: this.handleDate,
			"date>": (q, col, cols, val, opts) => this.handleDateComparison(q, col, cols, val, opts, ">"),
			"date>=": (q, col, cols, val, opts) => this.handleDateComparison(q, col, cols, val, opts, ">="),
			"date<": (q, col, cols, val, opts) => this.handleDateComparison(q, col, cols, val, opts, "<"),
			"date<=": (q, col, cols, val, opts) => this.handleDateComparison(q, col, cols, val, opts, "<="),
			dateBetween: this.handleDateBetween,
			inDate: this.handleInDate,
			dateTime: this.handleDateTime,
			"dateTime>": (q, col, cols, val, opts) => this.handleDateTimeComparison(q, col, cols, val, opts, ">"),
			"dateTime>=": (q, col, cols, val, opts) => this.handleDateTimeComparison(q, col, cols, val, opts, ">="),
			"dateTime<": (q, col, cols, val, opts) => this.handleDateTimeComparison(q, col, cols, val, opts, "<"),
			"dateTime<=": (q, col, cols, val, opts) => this.handleDateTimeComparison(q, col, cols, val, opts, "<="),
			dateTimeBetween: this.handleDateTimeBetween,
			inDateTime: this.handleInDateTime,
			scope: this.handleScope,
			with: this.handleWith,
			joinWith: this.handleJoinWith,
			similarTo: this.handleSimilarTo
		}[type];
	}
	/**
	* Apply standard where operators
	*/
	applyWhereOperator(query, operator, column, columns, value) {
		if (operator.startsWith("in") && operator !== "int" && !Array.isArray(value)) value = [value];
		if (column) switch (operator) {
			case "=":
				query.where(column, value);
				break;
			case "!=":
			case "<>":
				query.where(column, "!=", value);
				break;
			case ">":
			case ">=":
			case "<":
			case "<=":
				query.where(column, operator, value);
				break;
			case "in":
				query.whereIn(column, Array.isArray(value) ? value : [value]);
				break;
			case "not in":
				query.whereNotIn(column, Array.isArray(value) ? value : [value]);
				break;
			case "like":
				query.whereLike(column, value);
				break;
			case "not like":
				query.whereNotLike(column, value);
				break;
			case "between":
				query.whereBetween(column, value);
				break;
			case "not between":
				query.whereNotBetween(column, value);
				break;
		}
		else if (columns) {
			const conditions = {};
			for (const col of columns) conditions[col] = value;
			query.orWhere(conditions);
		}
	}
	handleBoolean(query, column, columns, value) {
		const boolValue = value === "true" || value === true || value === 1 || value === "1" || !isEmpty(value);
		if (column) query.where(column, boolValue);
		else if (columns) {
			const conditions = {};
			for (const col of columns) conditions[col] = boolValue;
			query.orWhere(conditions);
		}
	}
	handleInt(query, column, columns, value) {
		const intValue = parseInt(value);
		if (column) query.where(column, intValue);
		else if (columns) {
			const conditions = {};
			for (const col of columns) conditions[col] = intValue;
			query.orWhere(conditions);
		}
	}
	handleNotInt(query, column, columns, value) {
		const intValue = parseInt(value);
		if (column) query.where(column, "!=", intValue);
		else if (columns) for (const col of columns) query.orWhere(col, "!=", intValue);
	}
	handleIntComparison(query, column, columns, value, operator) {
		const intValue = parseInt(value);
		if (column) query.where(column, operator, intValue);
		else if (columns) for (const col of columns) query.orWhere(col, operator, intValue);
	}
	handleInInt(query, column, columns, value) {
		const values = (Array.isArray(value) ? value : [value]).map((v) => parseInt(v));
		if (column) query.whereIn(column, values);
		else if (columns) for (const col of columns) query.orWhere((q) => q.whereIn(col, values));
	}
	handleNumber(query, column, columns, value) {
		const numValue = Number(value);
		if (column) query.where(column, numValue);
		else if (columns) {
			const conditions = {};
			for (const col of columns) conditions[col] = numValue;
			query.orWhere(conditions);
		}
	}
	handleInNumber(query, column, columns, value) {
		const values = (Array.isArray(value) ? value : [value]).map((v) => Number(v));
		if (column) query.whereIn(column, values);
		else if (columns) for (const col of columns) query.orWhere((q) => q.whereIn(col, values));
	}
	handleFloat(query, column, columns, value) {
		const floatValue = parseFloat(value);
		if (column) query.where(column, floatValue);
		else if (columns) {
			const conditions = {};
			for (const col of columns) conditions[col] = floatValue;
			query.orWhere(conditions);
		}
	}
	handleNull(query, column, columns) {
		if (column) query.whereNull(column);
		else if (columns) for (const col of columns) query.orWhere({ [col]: null });
	}
	handleNotNull(query, column, columns) {
		if (column) query.whereNotNull(column);
		else if (columns) for (const col of columns) query.orWhere((q) => q.whereNotNull(col));
	}
	/**
	* Handle scope filter - applies local scope and passes the filter value.
	*
	* Usage in filterBy:
	* ```typescript
	* filterBy: {
	*   active: "scope",           // Uses the filter key as scope name
	*   isAdmin: ["scope", "admin"] // Uses custom scope name
	* }
	* ```
	*
	* When list({ active: true }) is called, it will call query.scope("active", true)
	* When list({ status: "pending" }) is called, it will call query.scope("status", "pending")
	*/
	handleScope(query, column, _columns, value) {
		if (column) query.scope(column, value);
	}
	/**
	* Handle with filter - eager-loads a relation when the filter value is truthy.
	*
	* Usage in filterBy:
	* ```typescript
	* filterBy: {
	*   with_ai_model: ["with", "ai_model"],         // load single relation
	*   with_all:      ["with", ["ai_model", "unit"]] // load multiple relations
	* }
	* ```
	*
	* When list({ with_ai_model: true }) is called, it will call query.with("ai_model")
	*/
	handleWith(query, column, columns, value) {
		if (!value) return;
		if (column) {
			if (query.with) query.with(column);
			return;
		}
		if (columns) {
			for (const relation of columns) if (query.with) query.with(relation);
		}
	}
	/**
	* Handle joinWith filter - eager-loads a relation via SQL JOIN when the filter value is truthy.
	*
	* Usage in filterBy:
	* ```typescript
	* filterBy: {
	*   with_ai_model: ["joinWith", "ai_model"],         // load single relation via join
	*   with_all:      ["joinWith", ["ai_model", "unit"]] // load multiple relations via join
	* }
	* ```
	*
	* When list({ with_ai_model: true }) is called, it will call query.joinWith("ai_model")
	*/
	handleJoinWith(query, column, columns, value) {
		if (!value) return;
		if (!query.joinWith) {
			console.warn("[Repository] joinWith is not supported by the query builder. using with instead.");
			return this.handleWith(query, column, columns, value);
		}
		if (column) {
			query.joinWith(column);
			return;
		}
		if (columns) query.joinWith(...columns);
	}
	/**
	* Handle similarTo filter — performs vector similarity search.
	*
	* The filter value must be a `number[]` (pre-computed embedding).
	* Delegates to `query.similarTo(column, embedding)` which is handled
	* driver-specifically (pgvector or MongoDB Atlas $vectorSearch).
	*
	* Usage in filterBy:
	* ```typescript
	* filterBy: {
	*   organization_id: "=",
	*   embedding: "similarTo",
	* }
	* ```
	*
	* Then in the service:
	* ```typescript
	* await vectorsRepository.list({ embedding: queryEmbedding, organization_id: orgId });
	* ```
	*/
	handleSimilarTo(query, column, _columns, value) {
		if (!column || !Array.isArray(value)) return;
		query.similarTo(column, value);
	}
	handleDate(query, column, columns, value, options) {
		const dateValue = this.parseDate(value, options?.dateFormat);
		if (column) query.whereDate(column, dateValue);
		else if (columns) for (const col of columns) query.orWhere((q) => q.whereDate(col, dateValue));
	}
	handleDateComparison(query, column, columns, value, options, operator) {
		const dateValue = this.parseDate(value, options?.dateFormat);
		if (column) if (operator === ">" || operator === ">=") query.whereDateAfter(column, dateValue);
		else query.whereDateBefore(column, dateValue);
		else if (columns) for (const col of columns) if (operator === ">" || operator === ">=") query.orWhere((q) => q.whereDateAfter(col, dateValue));
		else query.orWhere((q) => q.whereDateBefore(col, dateValue));
	}
	handleDateBetween(query, column, columns, value, options) {
		if (!Array.isArray(value) || value.length !== 2) return;
		const [start, end] = value.map((v) => this.parseDate(v, options?.dateFormat));
		if (column) query.whereDateBetween(column, [start, end]);
		else if (columns) for (const col of columns) query.orWhere((q) => q.whereDateBetween(col, [start, end]));
	}
	handleInDate(query, column, columns, value, options) {
		const dates = (Array.isArray(value) ? value : [value]).map((v) => this.parseDate(v, options?.dateFormat));
		if (column) query.whereIn(column, dates);
		else if (columns) for (const col of columns) query.orWhere((q) => q.whereIn(col, dates));
	}
	handleDateTime(query, column, columns, value, options) {
		const dateValue = this.parseDateTime(value, options?.dateTimeFormat);
		if (column) query.where(column, dateValue);
		else if (columns) {
			const conditions = {};
			for (const col of columns) conditions[col] = dateValue;
			query.orWhere(conditions);
		}
	}
	handleDateTimeComparison(query, column, columns, value, options, operator) {
		const dateValue = this.parseDateTime(value, options?.dateTimeFormat);
		if (column) query.where(column, operator, dateValue);
		else if (columns) for (const col of columns) query.orWhere(col, operator, dateValue);
	}
	handleDateTimeBetween(query, column, columns, value, options) {
		if (!Array.isArray(value) || value.length !== 2) return;
		const [start, end] = value.map((v) => this.parseDateTime(v, options?.dateTimeFormat));
		if (column) query.whereBetween(column, [start, end]);
		else if (columns) for (const col of columns) query.orWhere((q) => q.whereBetween(col, [start, end]));
	}
	handleInDateTime(query, column, columns, value, options) {
		const dates = (Array.isArray(value) ? value : [value]).map((v) => this.parseDateTime(v, options?.dateTimeFormat));
		if (column) query.whereIn(column, dates);
		else if (columns) for (const col of columns) query.orWhere((q) => q.whereIn(col, dates));
	}
	/**
	* Parse date string to Date object
	* TODO: Implement proper date parsing with format support
	*/
	parseDate(value, format) {
		if (value instanceof Date) return value;
		return new Date(value);
	}
	/**
	* Parse datetime string to Date object
	* TODO: Implement proper datetime parsing with format support
	*/
	parseDateTime(value, format) {
		if (value instanceof Date) return value;
		return new Date(value);
	}
};
//#endregion
export { FilterApplicator };

//# sourceMappingURL=filter-applicator.mjs.map