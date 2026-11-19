/**
 * `@warlock.js/grimoire/warlock` (experimental): the Warlock adapter, the
 * `grimoire` and `scry` commands, and their MCP tools.
 *
 * ```ts
 * // warlock.config.ts
 * import { registerGrimoireCommands } from "@warlock.js/grimoire/warlock";
 *
 * export default defineConfig({ cli: { commands: [registerGrimoireCommands()] } });
 * ```
 *
 * This file is reached from `warlock.config.ts`, so it imports only
 * `@warlock.js/core` (root: `command`, `withMcpTools`, `withExplainCodes`,
 * `inputSchema`) at top level. `@warlock.js/core/tooling` and the Grimoire
 * modules that build the book are loaded inside actions, tool `run`
 * functions and adapter methods.
 */
export {
  createWarlockAdapter,
  liveInspect,
  type LiveInspectTooling,
  type WarlockAdapterOptions,
  type WarlockInspect,
} from "./adapter";
export { registerGrimoireCommands } from "./commands";
export {
  collectMobileFacts,
  type CollectMobileFactsOptions,
  type MobileAppOption,
} from "./mobile-facts";
