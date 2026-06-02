import { get, merge, only, set, unset } from "@mongez/reinforcements";
//#region ../../@warlock.js/cascade/src/model/methods/accessor-methods.ts
/**
* Sentinel symbol to distinguish a genuinely missing field from a field
* whose value is `undefined`. Encapsulated here — callers use `hasField()`.
*/
const MISSING_VALUE = Symbol("missing");
function getFieldValue(model, field, defaultValue) {
	return get(model.data, field, defaultValue);
}
function setFieldValue(model, field, value) {
	const path = String(field);
	set(model.data, path, value);
	const partial = {};
	set(partial, path, value);
	model.dirtyTracker.mergeChanges(partial);
	return model;
}
function hasField(model, field) {
	return get(model.data, field, MISSING_VALUE) !== MISSING_VALUE;
}
function incrementField(model, field, amount) {
	return setFieldValue(model, field, getFieldValue(model, field, 0) + (amount ?? 1));
}
function decrementField(model, field, amount) {
	return setFieldValue(model, field, getFieldValue(model, field, 0) - (amount ?? 1));
}
function unsetFields(model, ...fields) {
	model.data = unset(model.data, fields);
	model.dirtyTracker.unset(fields);
	return model;
}
function mergeFields(model, values) {
	model.data = merge(model.data, values);
	model.dirtyTracker.mergeChanges(values);
	return model;
}
function getOnlyFields(model, fields) {
	return only(model.data, fields);
}
function getStringField(model, key, defaultValue) {
	return getFieldValue(model, key, defaultValue);
}
function getNumberField(model, key, defaultValue) {
	return getFieldValue(model, key, defaultValue);
}
function getBooleanField(model, key, defaultValue) {
	return getFieldValue(model, key, defaultValue);
}
//#endregion
export { decrementField, getBooleanField, getFieldValue, getNumberField, getOnlyFields, getStringField, hasField, incrementField, mergeFields, setFieldValue, unsetFields };

//# sourceMappingURL=accessor-methods.mjs.map