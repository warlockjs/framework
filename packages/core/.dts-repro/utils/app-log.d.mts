//#region ../../@warlock.js/core/src/utils/app-log.d.ts
declare const appLog: {
  info: (module: string, message: string) => Promise<import("@warlock.js/logger").Logger>;
  error: (module: string, message: string) => Promise<import("@warlock.js/logger").Logger>;
  warn: (module: string, message: string) => Promise<import("@warlock.js/logger").Logger>;
  debug: (module: string, message: string) => Promise<import("@warlock.js/logger").Logger>;
  success: (module: string, message: string) => Promise<import("@warlock.js/logger").Logger>;
};
//#endregion
export { appLog };
//# sourceMappingURL=app-log.d.mts.map