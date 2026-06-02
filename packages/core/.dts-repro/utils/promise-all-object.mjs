//#region ../../@warlock.js/core/src/utils/promise-all-object.ts
/**
* Resolve all of the given promises in the object and return the results as an object.
* This is more convenient than using `Promise.all` and then mapping the results back to the keys.
*/
async function promiseAllObject(promises) {
	const results = await Promise.all(Object.values(promises));
	return Object.keys(promises).reduce((result, key, index) => {
		result[key] = results[index];
		return result;
	}, {});
}
//#endregion
export { promiseAllObject };

//# sourceMappingURL=promise-all-object.mjs.map