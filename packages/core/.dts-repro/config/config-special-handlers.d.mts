import { SpecialConfigHandler } from "./config-loader.mjs";

//#region ../../@warlock.js/core/src/config/config-special-handlers.d.ts
declare class ConfigSpecialHandlers {
  /**
   * Handlers
   */
  protected handlers: Map<string, SpecialConfigHandler>;
  /**
   * Register a new handler
   */
  register(configName: string, handler: SpecialConfigHandler): void;
  /**
   * Execute handler for the given config name
   */
  execute(configName: string, config: any): Promise<void>;
}
declare const configSpecialHandlers: ConfigSpecialHandlers;
//#endregion
export { ConfigSpecialHandlers, configSpecialHandlers };
//# sourceMappingURL=config-special-handlers.d.mts.map