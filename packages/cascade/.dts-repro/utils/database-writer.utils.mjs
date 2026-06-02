//#region ../../@warlock.js/cascade/src/utils/database-writer.utils.ts
/**
* Transfer value before saving it into the database
*/
function useModelTransformer(callback) {
	const transformCallback = (data, { context }) => {
		const model = context.rootContext?.model;
		const column = context.key;
		const value = data;
		const isChanged = model.isDirty(column);
		const isNew = model.isNew;
		return callback({
			model,
			column,
			value,
			isChanged,
			isNew
		});
	};
	return transformCallback;
}
//#endregion
export { useModelTransformer };

//# sourceMappingURL=database-writer.utils.mjs.map