import { CascadeQueryBuilder } from "./cascade-query-builder.mjs";
import { Model } from "@warlock.js/cascade";
//#region ../../@warlock.js/core/src/repositories/adapters/cascade/cascade-adapter.ts
/**
* Cascade adapter for Cascade-Next ORM
* Implements RepositoryAdapterContract for @warlock.js/cascade
*
* @template T - The model instance type
*/
var CascadeAdapter = class {
	/**
	* Constructor
	* @param model - Cascade-Next Model class
	*/
	constructor(model) {
		this.model = model;
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.query}
	*/
	query() {
		return new CascadeQueryBuilder(this.model.query());
	}
	/**
	* Register all events
	*/
	registerEvents(eventsCallback) {
		const events = [];
		const modelEvents = this.model.events();
		events.push(modelEvents.onCreated((model) => {
			eventsCallback(model);
		}), modelEvents.onUpdated((model) => {
			eventsCallback(model);
		}), modelEvents.onDeleted((model) => {
			eventsCallback(model);
		}));
		return events;
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.find}
	*/
	async find(id) {
		return await this.model.find(id);
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.findBy}
	*/
	async findBy(column, value) {
		return await this.query().where(column, value).first();
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.serializeModel}
	*/
	serializeModel(model) {
		return model.toSnapshot();
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.deserializeModel}
	*/
	deserializeModel(data) {
		return this.model.fromSnapshot(data);
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.resolveRepositoryName}
	*/
	resolveRepositoryName() {
		return this.model.table;
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.create}
	*/
	async create(data) {
		return this.model.create(data);
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.update}
	*/
	async update(id, data) {
		const model = id instanceof Model ? id : await this.model.find(id);
		if (!model) throw new Error(`Model not found with id ${id}`);
		await model.save({ merge: data });
		return model;
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.delete}
	*/
	async delete(id) {
		await this.model.delete({ id });
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.updateMany}
	*/
	async updateMany(filter, data) {
		const query = this.query();
		if (typeof filter === "object") query.where(filter);
		const records = await query.get();
		for (const record of records) await this.update(record.id, data);
		return records.length;
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.deleteMany}
	*/
	async deleteMany(filter) {
		const query = this.query();
		if (typeof filter === "object") query.where(filter);
		const records = await query.get();
		for (const record of records) await record.destroy();
		return records.length;
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.count}
	*/
	async count(filter) {
		const query = this.query();
		if (filter && typeof filter === "object") query.where(filter);
		return query.count();
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.paginate}
	*/
	async paginate(page, limit) {
		return this.query().paginate(page, limit);
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.cursorPaginate}
	*/
	async cursorPaginate(options) {
		return this.query().cursorPaginate(options);
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.chunk}
	*/
	async chunk(size, callback) {
		return this.query().chunk(size, callback);
	}
	/**
	* {@inheritDoc RepositoryAdapterContract.createModel}
	*/
	createModel(data) {
		return new this.model(data);
	}
};
//#endregion
export { CascadeAdapter };

//# sourceMappingURL=cascade-adapter.mjs.map