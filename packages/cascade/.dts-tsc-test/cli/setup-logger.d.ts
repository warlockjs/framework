import { type LogLevel } from "@warlock.js/logger";
/**
 * Options for {@link setLoggerConfig}. Every field optional — call with no
 * arguments to get the standard CLI logger.
 */
export type SetLoggerConfigOptions = {
    /**
     * Pretty-print log entry context as a second line via `util.inspect`.
     * Useful while debugging; noisy for regular CLI use.
     *
     * @default false
     */
    readonly showContext?: boolean;
    /**
     * Logger-wide minimum severity. Entries below this level are dropped
     * before any channel is invoked.
     *
     * @default undefined (every level reaches the console channel)
     */
    readonly minLevel?: LogLevel;
};
/**
 * Configure `@warlock.js/logger` for the standalone Cascade CLI.
 *
 * The logger singleton ships with **zero channels** — without configuring
 * it, every `log.info` / `log.warn` / `log.error` / `log.success` call in
 * the migration runner is a silent no-op. In a warlock application the
 * bootstrap step registers channels; the standalone CLI has no bootstrap,
 * so we do it here.
 *
 * Calling this replaces any previously-configured channels — safe to invoke
 * multiple times to reconfigure mid-process.
 *
 * @example
 * setLoggerConfig();
 * setLoggerConfig({ minLevel: "warn" });
 * setLoggerConfig({ showContext: true });
 */
export declare function setLoggerConfig(options?: SetLoggerConfigOptions): void;
//# sourceMappingURL=setup-logger.d.ts.map