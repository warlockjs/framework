import { useRequestStore } from "../http/context/request-context.mjs";
//#region ../../@warlock.js/core/src/utils/get-localized.ts
/**
* Get localized value based on the given locale code
* If the locale code is not given and the function is called within a request context, it will get the current locale code
*/
function getLocalized(values, localeCode, key = "value") {
	if (!values) return values;
	if (!localeCode) localeCode = useRequestStore().request?.getLocaleCode();
	if (Array.isArray(values)) return values.find((value) => value.localeCode === localeCode)?.[key];
	return values;
}
//#endregion
export { getLocalized };

//# sourceMappingURL=get-localized.mjs.map