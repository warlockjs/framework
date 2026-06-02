//#region ../../@warlock.js/cascade/src/model/methods/dirty-methods.ts
function checkHasChanges(model) {
	return model.dirtyTracker.hasChanges();
}
function checkIsDirty(model, column) {
	return model.dirtyTracker.isDirty(column);
}
function getDirtyColumnsWithValues(model) {
	return model.dirtyTracker.getDirtyColumnsWithValues();
}
function getRemovedColumns(model) {
	return model.dirtyTracker.getRemovedColumns();
}
function getDirtyColumns(model) {
	return model.dirtyTracker.getDirtyColumns();
}
//#endregion
export { checkHasChanges, checkIsDirty, getDirtyColumns, getDirtyColumnsWithValues, getRemovedColumns };

//# sourceMappingURL=dirty-methods.mjs.map