import { Environment } from "../utils/environment.mjs";

//#region ../../@warlock.js/core/src/application/application.d.ts
declare class Application {
  /**
   * Project start time regarding the process start time
   */
  static readonly startedAt: Date;
  /**
   * Runtime strategy
   */
  static runtimeStrategy: "production" | "development";
  /**
   * Get framework version
   */
  static get version(): string | null;
  /**
   * Set the runtime strategy
   */
  static setRuntimeStrategy(strategy: "production" | "development"): void;
  /**
   * Get project uptime in milliseconds
   */
  static get uptime(): number;
  /**
   * Get the current environment
   */
  static get environment(): Environment;
  /**
   * Set the current environment
   */
  static setEnvironment(env: Environment): void;
  /**
   * Check if the application is running in production environment
   */
  static get isProduction(): boolean;
  /**
   * Check if the application is running in development environment
   */
  static get isDevelopment(): boolean;
  /**
   * Check if the application is running in test environment
   */
  static get isTest(): boolean;
  /**
   * Get the root path
   */
  static get rootPath(): string;
  /**
   * Get the src path
   */
  static get srcPath(): string;
  /**
   * Get the app path
   */
  static get appPath(): string;
  /**
   * Get the storage path
   */
  static get storagePath(): string;
  /**
   * Get the uploads path
   */
  static get uploadsPath(): string;
  /**
   * Get the public path
   */
  static get publicPath(): string;
}
//#endregion
export { Application };
//# sourceMappingURL=application.d.mts.map