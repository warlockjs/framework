//#region ../../@warlock.js/core/src/utils/get-localized.d.ts
type LocalizedObject = {
  localeCode: string;
  value: any;
};
/**
 * Get localized value based on the given locale code
 * If the locale code is not given and the function is called within a request context, it will get the current locale code
 */
declare function getLocalized(values: LocalizedObject[], localeCode?: string, key?: string): any;
//#endregion
export { LocalizedObject, getLocalized };
//# sourceMappingURL=get-localized.d.mts.map