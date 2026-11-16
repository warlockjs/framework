/**
 * `@warlock.js/grimoire/vitest` (owned by T-133): a Vitest reporter that
 * records the outcome of every test proving a criterion in
 * `grimoire/book/test-results.json`.
 *
 * ```ts
 * // vitest.config.ts
 * import { grimoireReporter } from "@warlock.js/grimoire/vitest";
 *
 * export default defineConfig({ test: { reporters: ["default", grimoireReporter()] } });
 * ```
 *
 * Framework-neutral: this entry must not import `@warlock.js/core`,
 * `@warlock.js/web` or `vitest` at runtime (the reporter is typed structurally).
 */

/** Options of `grimoireReporter()`. */
export type GrimoireReporterOptions = {
  /** Project root. Default: Vitest's `config.root`, else `process.cwd()`. */
  root?: string;
};

/** The reporter, typed structurally (only the hooks it implements). */
export type GrimoireReporter = {
  onInit?(context: unknown): void;
  onTestRunEnd?(...args: unknown[]): void | Promise<void>;
};

/** Create the reporter. */
export function grimoireReporter(options: GrimoireReporterOptions = {}): GrimoireReporter {
  void options;
  throw new Error("not implemented");
}
