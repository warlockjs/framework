import { isIterable, isPlainObject, isScalar } from "@mongez/supportive-is";
//#region ../../@warlock.js/core/src/utils/to-json.ts
async function toJson(value) {
	if (!value || isScalar(value)) return value;
	if (value.toJSON) return await value.toJSON();
	if (isIterable(value)) {
		const values = Array.from(value);
		return Promise.all(values.map(async (item) => {
			return await toJson(item);
		}));
	}
	if (!isPlainObject(value)) return value;
	for (const key in value) {
		const subValue = value[key];
		value[key] = await toJson(subValue);
	}
	return value;
}
//#endregion
export { toJson };

//# sourceMappingURL=to-json.mjs.map