/**
 * `@warlock.js/devtools/production`: what an app's `warlock.config.ts` needs
 * to run the production monitor (migrations and CLI commands). The monitor
 * itself starts from the devtools connector when `devtools.production.enabled`
 * is set.
 *
 * ```ts
 * import { devtoolsConnector } from "@warlock.js/devtools";
 * import { devtoolsMigrations, registerDevtoolsCommands } from "@warlock.js/devtools/production";
 *
 * export default defineConfig({
 *   connectors: [devtoolsConnector()],
 *   cli: { commands: [registerDevtoolsCommands()] },
 *   database: { migrations: [...devtoolsMigrations] },
 * });
 * ```
 */
export { registerDevtoolsCommands } from "./cli";
export { DEVTOOLS_CONFIG_CODES, DevtoolsProductionConfigError } from "./errors";
export { devtoolsMigrations } from "./store/migrations";
export type * from "./contracts";
export type { DevtoolsConfigCode } from "./errors";
export type { ResolvedDevtoolsProductionOptions } from "./options";
