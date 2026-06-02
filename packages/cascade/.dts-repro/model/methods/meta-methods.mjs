import { DatabaseWriter } from "../../writer/database-writer.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/meta-methods.ts
function applyDefaultsToModel(ModelClass, defaults) {
	if (defaults.autoGenerateId !== void 0 && ModelClass.autoGenerateId === void 0) ModelClass.autoGenerateId = defaults.autoGenerateId;
	if (defaults.initialId !== void 0 && ModelClass.initialId === void 0) ModelClass.initialId = defaults.initialId;
	if (defaults.randomInitialId !== void 0 && ModelClass.randomInitialId === void 0) ModelClass.randomInitialId = defaults.randomInitialId;
	if (defaults.incrementIdBy !== void 0 && ModelClass.incrementIdBy === void 0) ModelClass.incrementIdBy = defaults.incrementIdBy;
	if (defaults.randomIncrement !== void 0 && ModelClass.randomIncrement === void 0) ModelClass.randomIncrement = defaults.randomIncrement;
	if (defaults.createdAtColumn !== void 0 && ModelClass.createdAtColumn === void 0) ModelClass.createdAtColumn = defaults.createdAtColumn;
	if (defaults.updatedAtColumn !== void 0 && ModelClass.updatedAtColumn === void 0) ModelClass.updatedAtColumn = defaults.updatedAtColumn;
	if (defaults.deleteStrategy !== void 0 && ModelClass.deleteStrategy === void 0) ModelClass.deleteStrategy = defaults.deleteStrategy;
	if (defaults.deletedAtColumn !== void 0 && ModelClass.deletedAtColumn === void 0) ModelClass.deletedAtColumn = defaults.deletedAtColumn;
	if (defaults.trashTable !== void 0 && ModelClass.trashTable === void 0) if (typeof defaults.trashTable === "function") ModelClass.trashTable = defaults.trashTable(ModelClass.table);
	else ModelClass.trashTable = defaults.trashTable;
	if (defaults.strictMode !== void 0 && ModelClass.strictMode === void 0) ModelClass.strictMode = defaults.strictMode;
}
async function generateModelNextId(model) {
	await new DatabaseWriter(model).generateNextId();
	return model.id;
}
async function performAtomicUpdate(model, operations) {
	return model.self().atomic({ id: model.id }, operations);
}
async function performAtomicIncrement(model, field, amount = 1) {
	model.increment(field, amount);
	return performAtomicUpdate(model, { $inc: { [field]: amount } });
}
async function performAtomicDecrement(model, field, amount = 1) {
	model.decrement(field, amount);
	return performAtomicUpdate(model, { $inc: { [field]: -amount } });
}
//#endregion
export { applyDefaultsToModel, generateModelNextId, performAtomicDecrement, performAtomicIncrement, performAtomicUpdate };

//# sourceMappingURL=meta-methods.mjs.map