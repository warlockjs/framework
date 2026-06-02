import { DatabaseRemover } from "../../remover/database-remover.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/delete-methods.ts
async function destroyModel(model, options) {
	return new DatabaseRemover(model).destroy(options);
}
async function deleteRecords(ModelClass, filter) {
	return ModelClass.getDriver().deleteMany(ModelClass.table, filter);
}
async function deleteOneRecord(ModelClass, filter) {
	return ModelClass.getDriver().delete(ModelClass.table, filter);
}
//#endregion
export { deleteOneRecord, deleteRecords, destroyModel };

//# sourceMappingURL=delete-methods.mjs.map