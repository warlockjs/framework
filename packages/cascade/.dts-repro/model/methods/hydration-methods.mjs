import { RelationHydrator } from "../../relations/relation-hydrator.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/hydration-methods.ts
function hydrateModel(ModelClass, data) {
	const model = new ModelClass(ModelClass.getDriver().deserialize(data));
	model.isNew = false;
	return model;
}
function modelFromSnapshot(ModelClass, snapshot) {
	const model = ModelClass.hydrate(snapshot.data);
	RelationHydrator.hydrate(model, ModelClass.relations, snapshot.relations);
	return model;
}
function modelToSnapshot(model) {
	const driver = model.constructor.getDataSource().driver;
	const relations = {};
	for (const [name, related] of model.loadedRelations) if (related === null) relations[name] = null;
	else if (Array.isArray(related)) relations[name] = related.map((m) => m instanceof Object && typeof m.toSnapshot === "function" ? m.toSnapshot() : m);
	else if (related instanceof Object && typeof related.toSnapshot === "function") relations[name] = related.toSnapshot();
	return {
		data: driver.serialize({ ...model.data }),
		relations
	};
}
function serializeModel(model) {
	return model.constructor.getDataSource().driver.serialize(model.data);
}
function cloneModel(model) {
	const clonedData = JSON.parse(JSON.stringify(model.data));
	const clonedModel = new (model.self())(clonedData);
	clonedModel.isNew = model.isNew;
	deepFreezeObject(clonedModel.data);
	clonedModel.dirtyTracker.reset();
	return clonedModel;
}
function deepFreezeObject(obj) {
	Object.freeze(obj);
	Object.getOwnPropertyNames(obj).forEach((prop) => {
		const value = obj[prop];
		if (value !== null && (typeof value === "object" || typeof value === "function") && !Object.isFrozen(value)) deepFreezeObject(value);
	});
	return obj;
}
function replaceModelData(model, data) {
	model.data = data;
	model.dirtyTracker.replaceCurrentData(data);
}
//#endregion
export { cloneModel, deepFreezeObject, hydrateModel, modelFromSnapshot, modelToSnapshot, replaceModelData, serializeModel };

//# sourceMappingURL=hydration-methods.mjs.map