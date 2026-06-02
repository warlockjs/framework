//#region ../../@warlock.js/core/src/utils/paths.d.ts
/**
 * Get root path or join the given paths to the root path
 */
declare function rootPath(...paths: string[]): string;
/**
 * Get src directory path or join the given paths to the src directory path
 */
declare function srcPath(...paths: string[]): string;
/**
 * Get the absolute path to the storage folder to the given path
 *
 * If no path is given, it will return the absolute path to the storage folder
 */
declare function storagePath(relativePath?: string): string;
/**
 * Get the absolute path to the uploads folder to the given path
 *
 * If no path is given, it will return the absolute path to the uploads folder
 */
declare function uploadsPath(relativePath?: string): any;
/**
 * Get the absolute path to the public folder to the given path
 *
 * If no path is given, it will return the absolute path to the public folder
 */
declare function publicPath(relativePath?: string): string;
/**
 * Get the absolute path to the cache folder to the given path
 *
 * If no path is given, it will return the absolute path to the cache folder
 */
declare function cachePath(relativePath?: string): string;
/**
 * App path
 */
declare function appPath(relativePath?: string): string;
/**
 * Get logs directory path
 */
declare function logsPath(relativePath?: string): string;
/**
 * Get a temp path
 */
declare function tempPath(relativePath?: string): string;
declare function sanitizePath(filePath: string): string;
/**
 * Warlock path
 * PLEASE DO NOT add any files in this directory as it may be deleted
 */
declare function warlockPath(...path: string[]): string;
/**
 * Get config directory path
 */
declare function configPath(...path: string[]): string;
declare const paths: {
  root: typeof rootPath;
  src: typeof srcPath;
  storage: typeof storagePath;
  logs: typeof logsPath;
  uploads: typeof uploadsPath;
  public: typeof publicPath;
  cache: typeof cachePath;
  app: typeof appPath;
  temp: typeof tempPath;
  warlock: typeof warlockPath;
  config: typeof configPath;
  sanitize: typeof sanitizePath;
};
//#endregion
export { appPath, cachePath, configPath, logsPath, paths, publicPath, rootPath, sanitizePath, srcPath, storagePath, tempPath, uploadsPath, warlockPath };
//# sourceMappingURL=paths.d.mts.map