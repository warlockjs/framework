import slug from "@mongez/slug";
//#region ../../@warlock.js/core/src/utils/sluggable.ts
/**
* Used for model castings
*/
function sluggable(generateFrom, slugLocaleCode = "en") {
	return (model) => {
		let value = model.get(generateFrom);
		if (!value) return "";
		if (Array.isArray(value)) value = value.find((value) => value.localeCode === slugLocaleCode)?.value;
		return (slug.default || slug)(String(value));
	};
}
//#endregion
export { sluggable };

//# sourceMappingURL=sluggable.mjs.map