//#region ../../@warlock.js/core/src/utils/promise-all-object.d.ts
/**
 * Resolve all of the given promises in the object and return the results as an object.
 * This is more convenient than using `Promise.all` and then mapping the results back to the keys.
 */
declare function promiseAllObject<T extends Record<string, Promise<any>>>(promises: T): Promise<{ [K in keyof T]: T[K] extends Promise<infer U> ? U : never }>;
//#endregion
export { promiseAllObject };
//# sourceMappingURL=promise-all-object.d.mts.map