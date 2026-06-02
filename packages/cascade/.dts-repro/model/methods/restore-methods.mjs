import { DatabaseRestorer } from "../../restorer/database-restorer.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/restore-methods.ts
async function restoreRecord(ModelClass, id, options) {
	const result = await new DatabaseRestorer(ModelClass).restore(id, options);
	if (!result.restoredRecord) throw new Error(`Failed to restore ${ModelClass.name} with ${ModelClass.primaryKey} ${id}: no record returned.`);
	return result.restoredRecord;
}
async function restoreAllRecords(ModelClass, options) {
	const result = await new DatabaseRestorer(ModelClass).restoreAll(options);
	return result.restoredCount === 0 ? [] : result.restoredRecords;
}
//#endregion
export { restoreAllRecords, restoreRecord };

//# sourceMappingURL=restore-methods.mjs.map