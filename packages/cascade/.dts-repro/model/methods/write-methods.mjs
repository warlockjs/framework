import { emitModelEvent } from "./instance-event-methods.mjs";
import { DatabaseWriter } from "../../writer/database-writer.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/write-methods.ts
async function saveModel(model, options) {
	if (options?.merge) model.merge(options.merge);
	await new DatabaseWriter(model).save(options);
	return model;
}
async function createRecord(ModelClass, data) {
	const model = new ModelClass(data);
	await model.save();
	return model;
}
async function createManyRecords(ModelClass, data) {
	return await Promise.all(data.map((item) => createRecord(ModelClass, item)));
}
async function findOrCreateRecord(ModelClass, filter, data) {
	const existing = await ModelClass.first(filter);
	if (existing) return existing;
	return await createRecord(ModelClass, {
		...filter,
		...data
	});
}
async function upsertRecord(ModelClass, filter, data, options) {
	const driver = ModelClass.getDriver();
	const mergedData = {
		...filter,
		...data
	};
	const tempModel = new ModelClass(mergedData);
	tempModel.isNew = true;
	await emitModelEvent(tempModel, "saving", {
		isInsert: true,
		options,
		mode: "upsert"
	});
	const createdAtColumn = ModelClass.createdAtColumn;
	const updatedAtColumn = ModelClass.updatedAtColumn;
	if (createdAtColumn !== false && createdAtColumn !== void 0) {
		const createdAtKey = createdAtColumn;
		if (!mergedData[createdAtKey]) mergedData[createdAtKey] = /* @__PURE__ */ new Date();
	}
	if (updatedAtColumn !== false && updatedAtColumn !== void 0) {
		const updatedAtKey = updatedAtColumn;
		mergedData[updatedAtKey] = /* @__PURE__ */ new Date();
	}
	await emitModelEvent(tempModel, "saving", {
		filter,
		data: mergedData,
		options,
		mode: "upsert"
	});
	const result = await driver.upsert(ModelClass.table, filter, mergedData, options);
	const model = ModelClass.hydrate(result);
	model.dirtyTracker.reset();
	await emitModelEvent(model, "saved", {
		filter,
		data: result,
		options,
		mode: "upsert"
	});
	return model;
}
//#endregion
export { createManyRecords, createRecord, findOrCreateRecord, saveModel, upsertRecord };

//# sourceMappingURL=write-methods.mjs.map