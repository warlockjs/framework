import { FilterApplicator } from "./filter-applicator.mjs";
//#region ../../@warlock.js/core/src/repositories/adapters/cascade/cascade-query-builder.ts
/**
* Cascade query builder wrapper
* Wraps Cascade-Next's ModelAggregate to implement QueryBuilderContract
*
* @template T - The model instance type
*/
var CascadeQueryBuilder = class CascadeQueryBuilder {
	/**
	* Constructor
	* @param query - Cascade-Next QueryBuilder instance
	*/
	constructor(query) {
		this.query = query;
	}
	where(fieldOrConditionsOrCallback, operatorOrValue, value) {
		if (typeof fieldOrConditionsOrCallback === "function") fieldOrConditionsOrCallback(this);
		else if (typeof fieldOrConditionsOrCallback === "object") this.query.where(fieldOrConditionsOrCallback);
		else if (value !== void 0) this.query.where(fieldOrConditionsOrCallback, operatorOrValue, value);
		else this.query.where(fieldOrConditionsOrCallback, operatorOrValue);
		return this;
	}
	/**
	* Pretty display the query in terminal
	*/
	pretty() {
		return this.query.pretty();
	}
	orWhere(fieldOrConditions, operatorOrValue, value) {
		if (typeof fieldOrConditions === "object") this.query.orWhere(fieldOrConditions);
		else if (value !== void 0) this.query.orWhere(fieldOrConditions, operatorOrValue, value);
		else this.query.orWhere(fieldOrConditions, operatorOrValue);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.whereIn}
	*/
	whereIn(field, values) {
		this.query.whereIn(field, values);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.whereNotIn}
	*/
	whereNotIn(field, values) {
		this.query.whereNotIn(field, values);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.whereNull}
	*/
	whereNull(field) {
		this.query.whereNull(field);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.whereNotNull}
	*/
	whereNotNull(field) {
		this.query.whereNotNull(field);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.whereBetween}
	*/
	whereBetween(field, range) {
		this.query.whereBetween(field, range);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.whereLike}
	*/
	whereLike(field, pattern) {
		this.query.whereLike(field, pattern);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.similarTo}
	*/
	similarTo(column, embedding, alias) {
		this.query.similarTo(column, embedding, alias);
		return this;
	}
	select(...fields) {
		if (Array.isArray(fields[0])) this.query.select(fields[0]);
		else this.query.select(fields);
		return this;
	}
	deselect(...fields) {
		if (Array.isArray(fields[0])) this.query.deselect(fields[0]);
		else this.query.deselect(fields);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.orderBy}
	*/
	orderBy(field, direction = "asc") {
		this.query.orderBy(field, direction);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.sortBy}
	*/
	sortBy(orderBy) {
		for (const [field, direction] of Object.entries(orderBy)) this.query.orderBy(field, direction);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.random}
	*/
	random(limit) {
		this.query.orderByRandom(limit);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.limit}
	*/
	limit(limit) {
		this.query.limit(limit);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.offset}
	*/
	offset(offset) {
		this.query.offset(offset);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.skip}
	*/
	skip(count) {
		return this.offset(count);
	}
	/**
	* {@inheritDoc QueryBuilderContract.applyFilters}
	*/
	applyFilters(filters, data, options) {
		new FilterApplicator().apply(this.query, filters, data, options);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.get}
	*/
	async get() {
		return this.query.get();
	}
	/**
	* {@inheritDoc QueryBuilderContract.first}
	*/
	async first() {
		return this.query.first();
	}
	/**
	* {@inheritDoc QueryBuilderContract.count}
	*/
	async count() {
		return this.query.count();
	}
	/**
	* {@inheritDoc QueryBuilderContract.paginate}
	*/
	async paginate(page, limit) {
		const result = await this.query.paginate({
			limit,
			page
		});
		return {
			data: result.data,
			pagination: {
				...result.pagination,
				result: result.data.length
			}
		};
	}
	/**
	* {@inheritDoc QueryBuilderContract.cursorPaginate}
	*
	* NOTE: This method is a pure executor.
	* The caller (e.g. RepositoryManager._listImpl) is responsible for applying
	* the cursor WHERE condition and ORDER BY BEFORE calling this method,
	* so that the cursor column is always the primary sort key.
	*/
	async cursorPaginate(options) {
		const { limit, cursor, cursorColumn = "id" } = options;
		this.limit(limit + 1);
		const results = await this.get();
		const hasMore = results.length > limit;
		const documents = hasMore ? results.slice(0, limit) : results;
		const nextCursor = hasMore ? documents[documents.length - 1][cursorColumn] : void 0;
		return {
			data: documents,
			pagination: {
				limit,
				result: documents.length,
				hasMore,
				nextCursor,
				prevCursor: cursor
			}
		};
	}
	/**
	* {@inheritDoc QueryBuilderContract.chunk}
	*/
	async chunk(size, callback) {
		return this.query.chunk(size, callback);
	}
	/**
	* {@inheritDoc QueryBuilderContract.with}
	*/
	with(relation) {
		this.query.with(relation);
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.joinWith}
	*/
	joinWith(...relations) {
		if (this.query.joinWith) this.query.joinWith(...relations);
		else {
			console.warn("[Repository] joinWith is not supported by the underlying query builder. Falling back to with.");
			for (const relation of relations) this.query.with(relation);
		}
		return this;
	}
	/**
	* {@inheritDoc QueryBuilderContract.clone}
	*/
	clone() {
		return new CascadeQueryBuilder(this.query.clone());
	}
};
//#endregion
export { CascadeQueryBuilder };

//# sourceMappingURL=cascade-query-builder.mjs.map