import { registerPlugin } from "@warlock.js/seal";
import { databaseRulesPlugin } from "./plugins/database-rules-plugin";
import { embedValidator } from "./plugins/embed-validator-plugin";

registerPlugin(embedValidator);
registerPlugin(databaseRulesPlugin);

/**
 * This file registers database seal plugins as a side effect.
 * Import this file to ensure the plugins are registered.
 *
 * @example
 * ```ts
 * import "./validation/database-seal-plugins";
 * ```
 */
export type DatabaseSealPlugins = typeof embedValidator | typeof databaseRulesPlugin;
