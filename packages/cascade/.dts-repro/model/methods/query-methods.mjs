import { dataSourceRegistry } from "../../data-source/data-source-registry.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/query-methods.ts
function buildQuery(ModelClass, BaseModel) {
	const queryBuilder = ModelClass.newQueryBuilder();
	queryBuilder.pendingGlobalScopes = new Map([...BaseModel.globalScopes, ...ModelClass.globalScopes]);
	queryBuilder.availableLocalScopes = ModelClass.localScopes;
	queryBuilder.disabledGlobalScopes = /* @__PURE__ */ new Set();
	queryBuilder.relationDefinitions = ModelClass.relations;
	queryBuilder.modelClass = ModelClass;
	ModelClass.events().emitFetching(queryBuilder, {
		table: ModelClass.table,
		modelClass: ModelClass
	});
	queryBuilder.hydrate((data) => {
		return ModelClass.hydrate(data);
	});
	queryBuilder.onFetched(async (models) => {
		await ModelClass.events().emit("fetched", models, {});
	});
	return queryBuilder;
}
function buildNewQueryBuilder(ModelClass) {
	const dataSource = ModelClass.getDataSource();
	if (ModelClass.builder) {
		const BuilderClass = ModelClass.builder;
		return new BuilderClass(ModelClass.table, dataSource);
	}
	return dataSource.driver.queryBuilder(ModelClass.table);
}
async function findFirst(ModelClass, filter) {
	const query = ModelClass.query();
	if (filter) query.where(filter);
	return query.first();
}
async function findLast(ModelClass, filter) {
	const query = ModelClass.query();
	if (filter) query.where(filter);
	return query.last();
}
async function findAll(ModelClass, filter) {
	const query = ModelClass.query();
	if (filter) query.where(filter);
	return query.get();
}
function countRecords(ModelClass, filter) {
	const query = ModelClass.query();
	if (filter) query.where(filter);
	return query.count();
}
async function findById(ModelClass, id) {
	return ModelClass.query().where(ModelClass.primaryKey, id).first();
}
async function paginateRecords(ModelClass, options = {}) {
	const query = ModelClass.query();
	if (options.filter) query.where(options.filter);
	return query.paginate({
		limit: options.limit,
		page: options.page
	});
}
async function findLatest(ModelClass, filter) {
	const query = ModelClass.query();
	if (filter) query.where(filter);
	return await query.latest();
}
function increaseField(ModelClass, filter, field, amount) {
	return ModelClass.query().where(filter).increment(field, amount);
}
function decreaseField(ModelClass, filter, field, amount) {
	return ModelClass.query().where(filter).decrement(field, amount);
}
async function performAtomic(ModelClass, filter, operations) {
	return (await ModelClass.getDriver().atomic(ModelClass.table, filter, operations)).modifiedCount;
}
async function updateById(ModelClass, id, data) {
	return (await ModelClass.getDriver().update(ModelClass.table, { [ModelClass.primaryKey]: id }, { $set: data })).modifiedCount;
}
async function findAndUpdateRecords(ModelClass, filter, update) {
	await performAtomic(ModelClass, filter, update);
	return await ModelClass.query().where(filter).get();
}
async function findOneAndUpdateRecord(ModelClass, filter, update) {
	const result = await ModelClass.getDriver().findOneAndUpdate(ModelClass.table, filter, update);
	if (!result) return null;
	return new ModelClass(result);
}
async function findAndReplaceRecord(ModelClass, filter, document) {
	const result = await ModelClass.getDriver().replace(ModelClass.table, filter, document);
	if (!result) return null;
	return new ModelClass(result);
}
async function findOneAndDeleteRecord(ModelClass, filter, options) {
	const result = await ModelClass.getDriver().findOneAndDelete(ModelClass.table, filter, options);
	if (!result) return null;
	const model = ModelClass.hydrate(result);
	model.dirtyTracker.reset();
	return model;
}
function resolveDataSource(ModelClass) {
	const ref = ModelClass.dataSource;
	let dataSource;
	if (typeof ref === "string") dataSource = dataSourceRegistry.get(ref);
	else if (ref) dataSource = ref;
	else dataSource = dataSourceRegistry.get();
	if (!ModelClass.hasOwnProperty("_defaultsApplied")) {
		const driverDefaults = dataSource.driver.modelDefaults || {};
		const dataSourceDefaults = dataSource.modelDefaults || {};
		const mergedDefaults = {
			...driverDefaults,
			...dataSourceDefaults
		};
		if (Object.keys(mergedDefaults).length > 0) ModelClass.applyModelDefaults(mergedDefaults);
		ModelClass._defaultsApplied = true;
	}
	return dataSource;
}
//#endregion
export { buildNewQueryBuilder, buildQuery, countRecords, decreaseField, findAll, findAndReplaceRecord, findAndUpdateRecords, findById, findFirst, findLast, findLatest, findOneAndDeleteRecord, findOneAndUpdateRecord, increaseField, paginateRecords, performAtomic, resolveDataSource, updateById };

//# sourceMappingURL=query-methods.mjs.map