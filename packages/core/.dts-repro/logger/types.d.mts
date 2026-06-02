import { LogChannel } from "@warlock.js/logger";

//#region ../../@warlock.js/core/src/logger/types.d.ts
type EnvironmentConfigurations = {
  /**
   * List of logging channels
   */
  channels: LogChannel[];
  /**
   * Enable logging
   *
   * @default true
   */
  enabled?: boolean;
};
type LogConfigurations = {
  /**
   * Channels list
   * It will be used in all environments
   */
  channels?: LogChannel[];
  /**
   * Enable logging
   */
  enabled?: boolean;
  /**
   * Development environment configurations
   * This will override the default configurations
   */
  development?: EnvironmentConfigurations;
  /**
   * Test environment configurations
   */
  test?: EnvironmentConfigurations;
  /**
   * Production environment configurations
   */
  production?: EnvironmentConfigurations;
};
//#endregion
export { LogConfigurations };
//# sourceMappingURL=types.d.mts.map