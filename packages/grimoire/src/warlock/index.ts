/**
 * `@warlock.js/grimoire/warlock` (owned by T-130): the Warlock adapter, the
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
 * `@warlock.js/core` (root: `command`, `withMcpTools`) at top level. The
 * adapter, `@warlock.js/core/tooling` and `@warlock.js/web/build` are loaded
 * lazily inside actions and tool `run` functions.
 */
import type { CLICommand } from "@warlock.js/core";
import type { BookAdapter } from "../contracts/adapter";

/** Options of `createWarlockAdapter()`. */
export type WarlockAdapterOptions = {
  /**
   * Mobile apps in the repository: folder → routing. Default: every top-level
   * folder with an `app.json` or `app.config.ts` and `expo-router` in its
   * `package.json` is a file-routed app; none otherwise.
   */
  mobile?: readonly { root: string; id?: string; routing?: "files" | "code" }[];
};

/** The adapter over `inspectApp()` and the web page graph. */
export function createWarlockAdapter(options: WarlockAdapterOptions = {}): BookAdapter {
  void options;
  throw new Error("not implemented");
}

/**
 * The `grimoire <action> [release]` and `scry [file]` commands, with the
 * Grimoire MCP tools attached through `withMcpTools`. `cli.commands` accepts
 * this array as one item (core flattens nested arrays).
 */
export function registerGrimoireCommands(options: WarlockAdapterOptions = {}): CLICommand[] {
  void options;
  throw new Error("not implemented");
}
