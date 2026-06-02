import { isAggregateExpression } from "../../expressions/aggregate-expressions.mjs";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-query-parser.ts
/**
* Parses query builder operations into MongoDB aggregation pipeline.
*
* This parser is responsible for converting the abstract operations collected
* by the query builder into a concrete MongoDB aggregation pipeline. It handles
* intelligent grouping of mergeable operations (like multiple where clauses)
* into single pipeline stages for optimal performance.
*/
var MongoQueryParser = class {
	/**
	* The MongoDB collection being queried.
	*/
	collection;
	/**
	* The ordered list of operations to parse.
	*/
	operations;
	/**
	* Factory for creating sub-builders (used when resolving callbacks).
	*/
	createSubBuilder;
	/**
	* Track group field names for automatic _id renaming.
	* Maps pipeline index to field names.
	*/
	groupFieldNames = /* @__PURE__ */ new Map();
	/**
	* Create a new MongoDB query parser.
	*
	* @param options - Configuration options for the parser
	*/
	constructor(options) {
		this.collection = options.collection;
		this.operations = options.operations;
		this.createSubBuilder = options.createSubBuilder;
	}
	/**
	* Parse the operations into a MongoDB aggregation pipeline.
	*
	* This method intelligently groups mergeable operations (e.g., multiple where
	* clauses) into single pipeline stages while maintaining the correct execution
	* order for non-mergeable operations.
	*
	* @returns The MongoDB aggregation pipeline
	*
	* @example
	* ```typescript
	* const parser = new MongoQueryParser({ collection, operations });
	* const pipeline = parser.parse();
	* // [
	* //   { $match: { status: 'active', age: { $gt: 18 } } },
	* //   { $sort: { createdAt: -1 } },
	* //   { $limit: 10 }
	* // ]
	* ```
	*/
	parse() {
		const pipeline = [];
		let currentStage = null;
		let currentBuffer = [];
		for (const op of this.operations) if (op.mergeable && op.stage === currentStage) currentBuffer.push(op);
		else {
			if (currentBuffer.length > 0) {
				const builtStage = this.buildStage(currentStage, currentBuffer);
				if (builtStage) {
					const stageIndex = pipeline.length;
					pipeline.push(builtStage);
					this.trackGroupFieldNames(currentStage, currentBuffer, stageIndex);
				}
				currentBuffer = [];
			}
			if (op.mergeable) {
				currentStage = op.stage;
				currentBuffer.push(op);
			} else {
				const builtStage = this.buildStage(op.stage, [op]);
				if (builtStage) {
					const stageIndex = pipeline.length;
					pipeline.push(builtStage);
					this.trackGroupFieldNames(op.stage, [op], stageIndex);
				}
				currentStage = null;
			}
		}
		if (currentBuffer.length > 0) {
			const builtStage = this.buildStage(currentStage, currentBuffer);
			if (builtStage) {
				const stageIndex = pipeline.length;
				pipeline.push(builtStage);
				this.trackGroupFieldNames(currentStage, currentBuffer, stageIndex);
			}
		}
		return this.postProcessGroupStages(pipeline);
	}
	/**
	* Track field names for group stages that need _id renaming.
	*/
	trackGroupFieldNames(stage, operations, stageIndex) {
		if (stage === "$group") {
			const op = operations[0];
			if (op.type === "groupByWithAggregates" && op.data.fields) {
				const fieldNames = this.extractGroupFieldNames(op.data.fields);
				if (fieldNames) this.groupFieldNames.set(stageIndex, fieldNames);
			}
		}
	}
	/**
	* Post-process pipeline to rename _id fields after $group stages.
	*
	* This automatically renames MongoDB's `_id` field to the actual field name(s)
	* used for grouping, making the results more intuitive.
	*
	* @param pipeline - The aggregation pipeline
	* @returns The processed pipeline
	*/
	postProcessGroupStages(pipeline) {
		const processed = [];
		for (let i = 0; i < pipeline.length; i++) {
			const stage = pipeline[i];
			if (stage.$group && this.groupFieldNames.has(i)) {
				const fieldNames = this.groupFieldNames.get(i);
				processed.push(stage);
				const projection = {};
				if (typeof fieldNames === "string") projection[fieldNames] = "$_id";
				else if (Array.isArray(fieldNames) && fieldNames.length > 0) for (const fieldName of fieldNames) projection[fieldName] = `$_id.${fieldName}`;
				const aggregateFields = Object.keys(stage.$group).filter((key) => key !== "_id");
				for (const field of aggregateFields) projection[field] = 1;
				if (Object.keys(projection).length > 0) {
					projection._id = 0;
					processed.push({ $project: projection });
				}
			} else processed.push(stage);
		}
		return processed;
	}
	/**
	* Convert the parsed pipeline to a pretty-printed string for debugging.
	*
	* This method formats the MongoDB aggregation pipeline in a human-readable
	* way, making it easier to understand and debug complex queries.
	*
	* @returns A formatted string representation of the pipeline
	*
	* @example
	* ```typescript
	* const parser = new MongoQueryParser({ collection, operations });
	* console.log(parser.toPrettyString());
	* // Output:
	* // MongoDB Aggregation Pipeline:
	* // ════════════════════════════
	* // Stage 1: $match
	* //   status: "active"
	* //   age: { $gt: 18 }
	* //
	* // Stage 2: $sort
	* //   createdAt: -1
	* ```
	*/
	toPrettyString() {
		const pipeline = this.parse();
		if (pipeline.length === 0) return "MongoDB Aggregation Pipeline: (empty)";
		let output = "MongoDB Aggregation Pipeline:\n";
		output += "═".repeat(50) + "\n";
		pipeline.forEach((stage, index) => {
			const stageName = Object.keys(stage)[0];
			const stageData = stage[stageName];
			if (index > 0) output += "\n";
			output += `Stage ${index + 1}: ${colors.redBright(stageName)}\n`;
			output += this.formatStageData(stageData, 2);
		});
		return output;
	}
	/**
	* Format stage data with proper indentation.
	*
	* @param data - The stage data to format
	* @param indent - The indentation level
	* @returns Formatted string
	*/
	formatStageData(data, indent = 0) {
		const spaces = " ".repeat(indent);
		if (typeof data !== "object" || data === null) return `${spaces}${JSON.stringify(data)}\n`;
		if (Array.isArray(data)) {
			if (data.length === 0) return `${spaces}[]`;
			let result = "";
			data.forEach((item, index) => {
				result += `${spaces}[${colors.magenta(index)}]:\n`;
				result += this.formatStageData(item, indent + 2);
			});
			return result;
		}
		let result = "";
		Object.entries(data).forEach(([key, value]) => {
			const coloredKey = key.startsWith("$") ? colors.magentaBright(key) : colors.blue(key);
			if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				result += `${spaces}${coloredKey}:\n`;
				result += this.formatStageData(value, indent + 2);
			} else if (Array.isArray(value)) {
				result += `${spaces}${coloredKey}:\n`;
				result += this.formatStageData(value, indent + 2);
			} else {
				const formattedValue = typeof value === "number" ? colors.yellowBright(value) : typeof value === "boolean" ? colors.cyanBright(value.toString()) : typeof value === "string" ? colors.greenBright(JSON.stringify(value)) : colors.greenBright(String(value));
				result += `${spaces}${coloredKey}: ${formattedValue}\n`;
			}
		});
		return result.endsWith("\n") ? result : `${result}\n`;
	}
	/**
	* Build a single pipeline stage from a group of operations.
	*
	* @param stage - The pipeline stage type
	* @param operations - The operations to build the stage from
	* @returns The built pipeline stage or null if no stage should be added
	*/
	buildStage(stage, operations) {
		switch (stage) {
			case "$match": return this.buildMatchStage(operations);
			case "$project": return this.buildProjectStage(operations);
			case "$sort": return this.buildSortStage(operations);
			case "$group": return this.buildGroupStage(operations);
			case "$lookup": return this.buildLookupStage(operations);
			case "$limit": return { $limit: operations[0].data.value };
			case "$skip": return { $skip: operations[0].data.value };
			case "$setWindowFields": return { $setWindowFields: operations[0].data.spec };
			default: return null;
		}
	}
	/**
	* Build a $match stage from where operations.
	*
	* Query building strategy:
	* - Top-level where() + orWhere() = Pure OR
	* - Use callbacks for AND + OR grouping
	*
	* @param operations - The where operations
	* @returns The $match stage or null
	*/
	buildMatchStage(operations) {
		const andFilter = {};
		const orClauses = [];
		const pendingSimpleWhere = [];
		let topLevelOrMode = false;
		const pushOr = (clause) => {
			if (!clause) return;
			if (this.isPureOrCondition(clause)) {
				orClauses.push(...clause.$or);
				return;
			}
			if (Array.isArray(clause)) {
				orClauses.push(...clause);
				return;
			}
			orClauses.push(clause);
		};
		const mergeAnd = (condition) => {
			if (!condition) return;
			Object.entries(condition).forEach(([key, value]) => {
				if (key === "$or") {
					pushOr(value);
					return;
				}
				if (value && typeof value === "object" && !Array.isArray(value) && andFilter[key] && typeof andFilter[key] === "object" && !Array.isArray(andFilter[key])) andFilter[key] = {
					...andFilter[key],
					...value
				};
				else andFilter[key] = value;
			});
		};
		const queueSimpleWhere = (condition) => {
			if (!condition) return;
			if (topLevelOrMode) pushOr(condition);
			else pendingSimpleWhere.push(condition);
		};
		const enterTopLevelOrMode = () => {
			if (topLevelOrMode) return;
			topLevelOrMode = true;
			while (pendingSimpleWhere.length > 0) {
				const condition = pendingSimpleWhere.shift();
				if (condition) pushOr(condition);
			}
		};
		const flushPendingSimpleWhere = () => {
			if (pendingSimpleWhere.length === 0) return;
			if (topLevelOrMode) pendingSimpleWhere.forEach(pushOr);
			else pendingSimpleWhere.forEach(mergeAnd);
			pendingSimpleWhere.length = 0;
		};
		for (const op of operations) {
			if (op.type === "where:callback" || op.type === "orWhere:callback") {
				flushPendingSimpleWhere();
				const callbackCondition = this.buildCallbackCondition(op.data);
				if (!callbackCondition) continue;
				if (op.type === "orWhere:callback" || topLevelOrMode && !this.isPureOrCondition(callbackCondition) || this.isPureOrCondition(callbackCondition)) {
					if (op.type === "orWhere:callback") enterTopLevelOrMode();
					pushOr(callbackCondition);
				} else mergeAnd(callbackCondition);
				continue;
			}
			if (op.type === "where:object") {
				queueSimpleWhere(op.data);
				continue;
			}
			if (op.type === "where:not" || op.type === "orWhere:not" || op.type === "where:exists" || op.type === "where:notExists") {
				const negated = op.type === "where:not" || op.type === "where:notExists";
				const nested = this.buildCallbackCondition(op.data.callback);
				if (nested) {
					const condition = negated ? { $nor: [nested] } : nested;
					if (op.type.startsWith("orWhere")) {
						enterTopLevelOrMode();
						pushOr(condition);
					} else queueSimpleWhere(condition);
				}
				continue;
			}
			if (op.type === "orWhere:object") {
				enterTopLevelOrMode();
				pushOr(op.data);
				continue;
			}
			const condition = this.buildWhereCondition(op);
			if (!condition) continue;
			if (op.type.startsWith("orWhere")) {
				enterTopLevelOrMode();
				pushOr(condition);
			} else queueSimpleWhere(condition);
		}
		flushPendingSimpleWhere();
		const hasAnd = Object.keys(andFilter).length > 0;
		const hasOr = orClauses.length > 0;
		if (!hasAnd && !hasOr) return null;
		const match = {};
		if (hasAnd) Object.assign(match, andFilter);
		if (hasOr) match.$or = orClauses;
		return { $match: match };
	}
	isPureOrCondition(condition) {
		return condition && typeof condition === "object" && !Array.isArray(condition) && Object.keys(condition).length === 1 && Array.isArray(condition.$or);
	}
	/**
	* Build a condition from a callback-based where clause.
	* Creates a sub-builder, executes the callback, and extracts the conditions.
	* If callback has orWhere, all conditions become OR.
	*
	* @param callback - The callback function
	* @returns The built condition or null
	*/
	buildCallbackCondition(callback) {
		const subBuilder = this.createSubBuilder();
		callback(subBuilder);
		const matchOps = subBuilder.operations.filter((op) => op.stage === "$match");
		if (matchOps.length === 0) return null;
		const andFilter = {};
		const orClauses = [];
		const hasInternalOr = matchOps.some((op) => op.type.startsWith("orWhere"));
		const pushOr = (clause) => {
			if (!clause) return;
			if (this.isPureOrCondition(clause)) {
				orClauses.push(...clause.$or);
				return;
			}
			orClauses.push(clause);
		};
		if (hasInternalOr) {
			for (const op of matchOps) {
				if (op.type === "where:callback" || op.type === "orWhere:callback") {
					const nestedCondition = this.buildCallbackCondition(op.data);
					if (nestedCondition) pushOr(nestedCondition);
					continue;
				}
				if (op.type === "where:object" || op.type === "orWhere:object") {
					pushOr(op.data);
					continue;
				}
				const condition = this.buildWhereCondition(op);
				if (condition) pushOr(condition);
			}
			return orClauses.length > 0 ? { $or: orClauses } : null;
		}
		for (const op of matchOps) if (op.type === "where:callback") {
			const nestedCondition = this.buildCallbackCondition(op.data);
			if (nestedCondition) Object.assign(andFilter, nestedCondition);
		} else if (op.type === "where:object") Object.assign(andFilter, op.data);
		else {
			const condition = this.buildWhereCondition(op);
			if (condition) Object.assign(andFilter, condition);
		}
		return Object.keys(andFilter).length > 0 ? andFilter : null;
	}
	/**
	* Build a MongoDB filter condition from a where operation.
	*
	* @param op - The operation to build
	* @returns The MongoDB filter condition
	*/
	buildWhereCondition(op) {
		const { field, operator, value } = op.data;
		switch (op.type) {
			case "where":
			case "orWhere": return this.buildOperatorCondition(field, operator, value);
			case "whereIn": return { [field]: { $in: value || op.data.values } };
			case "whereNotIn": return { [field]: { $nin: value || op.data.values } };
			case "whereNull": return { [field]: null };
			case "whereNotNull": return { [field]: { $ne: null } };
			case "whereBetween": return { [field]: {
				$gte: op.data.range[0],
				$lte: op.data.range[1]
			} };
			case "whereNotBetween": return { [field]: { $not: {
				$gte: op.data.range[0],
				$lte: op.data.range[1]
			} } };
			case "whereLike": {
				const pattern = typeof op.data.pattern === "string" ? op.data.pattern : op.data.pattern.source;
				return { [field]: {
					$regex: pattern,
					$options: "i"
				} };
			}
			case "whereNotLike": {
				const notPattern = typeof op.data.pattern === "string" ? op.data.pattern : op.data.pattern.source;
				return { [field]: { $not: {
					$regex: notPattern,
					$options: "i"
				} } };
			}
			case "whereStartsWith": return { [field]: {
				$regex: `^${op.data.value}`,
				$options: "i"
			} };
			case "whereNotStartsWith": return { [field]: { $not: {
				$regex: `^${op.data.value}`,
				$options: "i"
			} } };
			case "whereEndsWith": return { [field]: {
				$regex: `${op.data.value}$`,
				$options: "i"
			} };
			case "whereNotEndsWith": return { [field]: { $not: {
				$regex: `${op.data.value}$`,
				$options: "i"
			} } };
			case "whereExists": return { [field]: { $exists: true } };
			case "whereNotExists": return { [field]: { $exists: false } };
			case "whereSize": if (op.data.operator === "=") return { [field]: { $size: op.data.size } };
			else return { $expr: { [this.getMongoOperator(op.data.operator)]: [{ $size: `$${field}` }, op.data.size] } };
			case "textSearch": return {
				$text: { $search: op.data.query },
				...op.data.filters || {}
			};
			case "whereRaw":
			case "orWhereRaw": return this.resolveRawExpression(op.data.expression, op.data.bindings);
			case "whereColumn":
			case "orWhereColumn": return this.buildColumnComparison(op.data.first, op.data.operator, op.data.second);
			case "whereBetweenColumns": return this.buildBetweenColumnsCondition(op.data.field, op.data.lowerColumn, op.data.upperColumn);
			case "whereDate":
			case "whereDateEquals": return this.buildDateEqualityCondition(op.data.field, op.data.value);
			case "whereDateBefore": return this.buildDateBeforeCondition(op.data.field, op.data.value);
			case "whereDateAfter": return this.buildDateAfterCondition(op.data.field, op.data.value);
			case "whereTime": return this.buildTimeCondition(op.data.field, op.data.value);
			case "whereDay": return this.buildDatePartCondition(op.data.field, "$dayOfMonth", op.data.value);
			case "whereMonth": return this.buildDatePartCondition(op.data.field, "$month", op.data.value);
			case "whereYear": return this.buildDatePartCondition(op.data.field, "$year", op.data.value);
			case "whereJsonContains": return this.buildJsonContainsCondition(op.data.path, op.data.value);
			case "whereJsonDoesntContain": return this.buildJsonDoesntContainCondition(op.data.path, op.data.value);
			case "whereJsonContainsKey": return this.buildJsonContainsKeyCondition(op.data.path);
			case "whereJsonLength": return this.buildJsonLengthCondition(op.data.path, op.data.operator, op.data.value);
			case "whereJsonIsArray": return this.buildJsonTypeCondition(op.data.path, "array");
			case "whereJsonIsObject": return this.buildJsonTypeCondition(op.data.path, "object");
			case "whereArrayLength": return this.buildArrayLengthCondition(op.data.field, op.data.operator, op.data.value);
			case "whereFullText":
			case "orWhereFullText": return { $text: { $search: op.data.query } };
			case "whereSearch": return { [op.data.field]: {
				$regex: op.data.query,
				$options: "i"
			} };
			case "where:not":
			case "orWhere:not": {
				const nestedNot = this.buildCallbackCondition(op.data.callback);
				return nestedNot ? { $nor: [nestedNot] } : null;
			}
			case "where:exists": return this.buildCallbackCondition(op.data.callback);
			case "where:notExists": {
				const nestedExists = this.buildCallbackCondition(op.data.callback);
				return nestedExists ? { $nor: [nestedExists] } : null;
			}
			case "whereArrayContains": if (op.data.key) return { [field]: { $elemMatch: { [op.data.key]: op.data.value } } };
			else return { [field]: op.data.value };
			default: return null;
		}
	}
	/**
	* Build a condition based on the operator.
	*
	* @param field - The field name
	* @param operator - The comparison operator
	* @param value - The value to compare
	* @returns The MongoDB filter condition
	*/
	buildOperatorCondition(field, operator, value) {
		switch (operator) {
			case "=": return { [field]: value };
			case "!=": return { [field]: { $ne: value } };
			case ">": return { [field]: { $gt: value } };
			case ">=": return { [field]: { $gte: value } };
			case "<": return { [field]: { $lt: value } };
			case "<=": return { [field]: { $lte: value } };
			default: return { [field]: value };
		}
	}
	/**
	* Get MongoDB operator from comparison operator.
	*
	* @param operator - The comparison operator
	* @returns The MongoDB operator
	*/
	getMongoOperator(operator) {
		return {
			"=": "$eq",
			"!=": "$ne",
			">": "$gt",
			">=": "$gte",
			"<": "$lt",
			"<=": "$lte"
		}[operator] || "$eq";
	}
	resolveRawExpression(expression, bindings) {
		if (typeof expression === "string") return { $where: this.bindRawString(expression, bindings) };
		if (typeof expression === "object" && expression !== null) return expression;
		return null;
	}
	bindRawString(expression, bindings) {
		if (!bindings || bindings.length === 0) return expression;
		let index = 0;
		return expression.replace(/\?/g, () => {
			const value = bindings[index++];
			return value === void 0 ? "?" : JSON.stringify(value);
		});
	}
	buildColumnComparison(first, operator, second) {
		return { $expr: { [this.getMongoOperator(operator)]: [this.wrapColumn(first), this.wrapColumn(second)] } };
	}
	buildBetweenColumnsCondition(field, lower, upper) {
		return { $expr: { $and: [{ $gte: [this.wrapColumn(field), this.wrapColumn(lower)] }, { $lte: [this.wrapColumn(field), this.wrapColumn(upper)] }] } };
	}
	wrapColumn(column) {
		return column.startsWith("$") ? column : `$${column}`;
	}
	buildDateEqualityCondition(field, value) {
		const target = this.normalizeDateInput(value);
		const start = this.startOfDay(target);
		const end = this.endOfDay(target);
		return { [field]: {
			$gte: start,
			$lte: end
		} };
	}
	buildDateBeforeCondition(field, value) {
		const target = this.startOfDay(this.normalizeDateInput(value));
		return { [field]: { $lt: target } };
	}
	buildDateAfterCondition(field, value) {
		const target = this.endOfDay(this.normalizeDateInput(value));
		return { [field]: { $gt: target } };
	}
	buildTimeCondition(field, value) {
		return { $expr: { $eq: [{ $dateToString: {
			format: "%H:%M",
			date: `$${field}`
		} }, value] } };
	}
	buildDatePartCondition(field, operator, value) {
		return { $expr: { $eq: [{ [operator]: `$${field}` }, value] } };
	}
	buildJsonContainsCondition(path, value) {
		const fieldPath = this.normalizePath(path);
		if (Array.isArray(value)) return { [fieldPath]: { $all: value } };
		return { [fieldPath]: value };
	}
	buildJsonDoesntContainCondition(path, value) {
		const fieldPath = this.normalizePath(path);
		const values = Array.isArray(value) ? value : [value];
		return { [fieldPath]: { $nin: values } };
	}
	buildJsonContainsKeyCondition(path) {
		return { [this.normalizePath(path)]: { $exists: true } };
	}
	buildJsonLengthCondition(path, operator, value) {
		return { $expr: { [this.getMongoOperator(operator)]: [{ $size: { $ifNull: [`$${this.normalizePath(path)}`, []] } }, value] } };
	}
	buildJsonTypeCondition(path, type) {
		return { $expr: { $eq: [{ $type: `$${this.normalizePath(path)}` }, type] } };
	}
	buildArrayLengthCondition(field, operator, value) {
		return { $expr: { [this.getMongoOperator(operator)]: [{ $size: { $ifNull: [`$${field}`, []] } }, value] } };
	}
	normalizeDateInput(value) {
		if (value instanceof Date) return value;
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date value: ${value}`);
		return parsed;
	}
	startOfDay(date) {
		const copy = new Date(date);
		copy.setHours(0, 0, 0, 0);
		return copy;
	}
	endOfDay(date) {
		const copy = new Date(date);
		copy.setHours(23, 59, 59, 999);
		return copy;
	}
	normalizePath(path) {
		return path.replace(/->/g, ".");
	}
	applyProjectionFields(projection, fields, value) {
		for (const field of fields) projection[field] = value;
	}
	/**
	* Apply projection object with aliases and inclusion/exclusion.
	* @param projection - The projection object to modify
	* @param projectionObj - The projection specification
	*/
	applyProjectionObject(projection, projectionObj) {
		for (const [field, value] of Object.entries(projectionObj)) {
			if (typeof value === "boolean") {
				projection[field] = value ? 1 : 0;
				continue;
			}
			if (typeof value === "number") {
				projection[field] = value;
				continue;
			}
			if (typeof value === "string") {
				projection[value] = `$${field}`;
				continue;
			}
			if (typeof value === "object" && value !== null) {
				projection[field] = value;
				continue;
			}
			projection[field] = 1;
		}
	}
	applyRawProjection(projection, expression, bindings) {
		const resolved = this.resolveProjectionExpression(expression, bindings);
		if (!resolved) return;
		if (typeof resolved === "object" && resolved !== null && !Array.isArray(resolved)) Object.assign(projection, resolved);
	}
	resolveProjectionExpression(expression, bindings) {
		if (typeof expression === "string") {
			const source = bindings && expression.includes("?") ? this.bindRawString(expression, bindings) : expression;
			if (source.startsWith(":")) return source.slice(1);
			return this.normalizeFieldReference(source);
		}
		if (typeof expression === "object" && expression !== null && !(expression instanceof Date)) return expression;
		if (typeof expression === "number" || typeof expression === "boolean") return expression;
		return expression;
	}
	normalizeFieldReference(value) {
		if (typeof value === "string") {
			if (value.startsWith(":")) return value.slice(1);
			if (value.startsWith("$")) return value;
			if (!/^[a-zA-Z0-9_.]+$/.test(value)) return value;
			return `$${value}`;
		}
		return value;
	}
	buildAggregateProjection(field, aggregate) {
		if (aggregate === "count") return this.buildArraySizeExpression(field);
		const operator = {
			sum: "$sum",
			avg: "$avg",
			min: "$min",
			max: "$max",
			first: "$first",
			last: "$last"
		}[aggregate];
		if (!operator) return null;
		return { [operator]: this.normalizeFieldReference(field) };
	}
	buildExistsProjection(field) {
		return { $ne: [{ $type: `$${field}` }, "missing"] };
	}
	buildArraySizeExpression(field) {
		return { $size: { $ifNull: [`$${field}`, []] } };
	}
	buildCaseExpression(cases, otherwise) {
		return { $switch: {
			branches: cases.map((item) => ({
				case: this.resolveProjectionExpression(item.when),
				then: this.resolveLiteralOrExpression(item.then)
			})),
			default: this.resolveLiteralOrExpression(otherwise)
		} };
	}
	buildCondExpression(condition, thenValue, elseValue) {
		return { $cond: [
			this.resolveProjectionExpression(condition),
			this.resolveLiteralOrExpression(thenValue),
			this.resolveLiteralOrExpression(elseValue)
		] };
	}
	/**
	* Resolve a value as a literal (if it's a plain string) or as an expression.
	* Used for `then`/`default` values in CASE/WHEN expressions.
	*/
	resolveLiteralOrExpression(value) {
		if (typeof value === "string" && value.startsWith("$")) return value;
		if (typeof value === "string") return value;
		return this.resolveProjectionExpression(value);
	}
	inferJsonAlias(path) {
		const segments = this.normalizePath(path).split(".");
		return segments[segments.length - 1];
	}
	buildConcatExpression(values) {
		return { $concat: values.map((value) => this.normalizeFieldReference(value)) };
	}
	buildCoalesceExpression(values) {
		if (values.length === 0) return null;
		let expression = this.normalizeFieldReference(values[values.length - 1]);
		for (let index = values.length - 2; index >= 0; index--) expression = { $ifNull: [this.normalizeFieldReference(values[index]), expression] };
		return expression;
	}
	/**
	* Build a $project stage from select operations.
	*
	* @param operations - The select operations
	* @returns The $project stage or null
	*/
	buildProjectStage(operations) {
		if (operations.length === 0) return null;
		const projection = {};
		const driverCallbacks = [];
		for (const op of operations) switch (op.type) {
			case "select":
				if (op.data.projection) this.applyProjectionObject(projection, op.data.projection);
				else if (op.data.fields) this.applyProjectionFields(projection, op.data.fields, 1);
				break;
			case "deselect":
				this.applyProjectionFields(projection, op.data.fields, 0);
				break;
			case "addSelect":
				this.applyProjectionFields(projection, op.data.fields, 1);
				break;
			case "selectRaw":
				this.applyRawProjection(projection, op.data.expression, op.data.bindings);
				break;
			case "selectSub":
			case "addSelectSub": {
				const expr = this.resolveProjectionExpression(op.data.expression, op.data.bindings);
				if (expr !== void 0) projection[op.data.alias] = expr;
				break;
			}
			case "selectAggregate":
				projection[op.data.alias] = this.buildAggregateProjection(op.data.field, op.data.aggregate);
				break;
			case "selectExists":
				projection[op.data.alias] = this.buildExistsProjection(op.data.field);
				break;
			case "selectCount":
				projection[op.data.alias] = this.buildArraySizeExpression(op.data.field);
				break;
			case "selectCase":
				projection[op.data.alias] = this.buildCaseExpression(op.data.cases, op.data.otherwise);
				break;
			case "selectWhen":
				projection[op.data.alias] = this.buildCondExpression(op.data.condition, op.data.thenValue, op.data.elseValue);
				break;
			case "selectDriverProjection":
				driverCallbacks.push(op.data.callback);
				break;
			case "selectJson": {
				const alias = op.data.alias ?? this.inferJsonAlias(op.data.path);
				projection[alias] = this.normalizeFieldReference(`$${this.normalizePath(op.data.path)}`);
				break;
			}
			case "selectJsonRaw":
				projection[op.data.alias] = this.resolveProjectionExpression(op.data.expression);
				break;
			case "deselectJson":
				projection[this.normalizePath(op.data.path)] = 0;
				break;
			case "selectConcat":
				projection[op.data.alias] = this.buildConcatExpression(op.data.fields);
				break;
			case "selectCoalesce":
				projection[op.data.alias] = this.buildCoalesceExpression(op.data.fields);
				break;
			default: break;
		}
		for (const callback of driverCallbacks) callback(projection);
		return Object.keys(projection).length > 0 ? { $project: projection } : null;
	}
	/**
	* Build a $sort stage from order operations.
	*
	* @param operations - The order operations
	* @returns The $sort stage or null
	*/
	buildSortStage(operations) {
		const sort = {};
		for (const op of operations) switch (op.type) {
			case "orderBy":
				sort[op.data.field] = op.data.direction === "asc" ? 1 : -1;
				break;
			case "orderByRandom": return { $sample: { size: op.data.limit } };
			case "orderByRaw": break;
		}
		return Object.keys(sort).length > 0 ? { $sort: sort } : null;
	}
	/**
	* Build a $group stage from group operations.
	*
	* @param operations - The group operations
	* @returns The $group stage or null
	*/
	buildGroupStage(operations) {
		const op = operations[0];
		switch (op.type) {
			case "groupBy": {
				const stage = this.buildGroupByStage(op.data.fields);
				if (stage) return stage;
				break;
			}
			case "groupByWithAggregates": {
				const stage = this.buildGroupByWithAggregatesStage(op.data.fields, op.data.aggregates);
				if (stage) return stage;
				break;
			}
			case "groupByRaw": {
				const expression = op.data.expression;
				if (expression && typeof expression === "object") return { $group: expression };
				if (expression) return { $group: { _id: expression } };
				break;
			}
			case "distinct": {
				const stage = this.buildGroupByStage(op.data.fields);
				if (stage) return stage;
				break;
			}
			default: break;
		}
		return null;
	}
	buildGroupByStage(fields) {
		const groupId = this.buildGroupId(fields);
		if (!groupId) return null;
		return { $group: { _id: groupId } };
	}
	/**
	* Build a $group stage with aggregates from group operations.
	*
	* @param fields - Fields to group by
	* @param aggregates - Aggregate operations (abstract or raw)
	* @returns The $group stage or null
	*/
	buildGroupByWithAggregatesStage(fields, aggregates) {
		const groupId = this.buildGroupId(fields);
		if (!groupId) return null;
		const groupStage = { _id: groupId };
		for (const [alias, expression] of Object.entries(aggregates)) if (isAggregateExpression(expression)) groupStage[alias] = this.translateAggregateExpression(expression);
		else groupStage[alias] = expression;
		return { $group: groupStage };
	}
	/**
	* Extract field names from GroupByInput for renaming _id.
	*
	* @param fields - The grouping fields
	* @returns Field name(s) to use for renaming _id
	*/
	extractGroupFieldNames(fields) {
		if (typeof fields === "string") return fields;
		if (Array.isArray(fields)) {
			if (fields.every((field) => typeof field === "string")) return fields;
			return null;
		}
		if (typeof fields === "object" && fields !== null) return Object.keys(fields);
		return null;
	}
	/**
	* Translate an abstract aggregate expression to MongoDB format.
	*
	* @param expr - Abstract aggregate expression
	* @returns MongoDB aggregation expression
	*/
	translateAggregateExpression(expr) {
		switch (expr.__agg) {
			case "count": return { $sum: 1 };
			case "sum":
				if (!expr.__field) throw new Error("Sum aggregate requires a field name");
				return { $sum: `$${expr.__field}` };
			case "avg":
				if (!expr.__field) throw new Error("Average aggregate requires a field name");
				return { $avg: `$${expr.__field}` };
			case "min":
				if (!expr.__field) throw new Error("Min aggregate requires a field name");
				return { $min: `$${expr.__field}` };
			case "max":
				if (!expr.__field) throw new Error("Max aggregate requires a field name");
				return { $max: `$${expr.__field}` };
			case "first":
				if (!expr.__field) throw new Error("First aggregate requires a field name");
				return { $first: `$${expr.__field}` };
			case "last":
				if (!expr.__field) throw new Error("Last aggregate requires a field name");
				return { $last: `$${expr.__field}` };
			case "distinct":
				if (!expr.__field) throw new Error("Distinct aggregate requires a field name");
				return { $distinct: `$${expr.__field}` };
			case "floor":
				if (!expr.__field) throw new Error("Floor aggregate requires a field name");
				return { $floor: `$${expr.__field}` };
			default: throw new Error(`Unknown aggregate function: ${expr.__agg}`);
		}
	}
	buildGroupId(fields) {
		if (!fields) return null;
		if (typeof fields === "string") return `$${fields}`;
		if (Array.isArray(fields)) {
			if (fields.length === 0) return null;
			if (fields.every((field) => typeof field === "string")) {
				const result = {};
				for (const field of fields) result[field] = `$${field}`;
				return result;
			}
			return fields.reduce((acc, item) => ({
				...acc,
				...item
			}), {});
		}
		if (typeof fields === "object") {
			const normalized = {};
			Object.entries(fields).forEach(([key, value]) => {
				if (typeof value === "string" && !value.startsWith("$")) normalized[key] = `$${value}`;
				else normalized[key] = value;
			});
			return normalized;
		}
		return null;
	}
	/**
	* Build a $lookup stage from join operations.
	*
	* @param operations - The join operations
	* @returns The $lookup stage or null
	*/
	buildLookupStage(operations) {
		const options = operations[0].data;
		return { $lookup: {
			from: options.table,
			localField: options.localField,
			foreignField: options.foreignField,
			as: options.alias || options.table
		} };
	}
};
//#endregion
export { MongoQueryParser };

//# sourceMappingURL=mongodb-query-parser.mjs.map