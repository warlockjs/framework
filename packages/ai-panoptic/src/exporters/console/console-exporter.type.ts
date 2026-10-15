/**
 * Sink a {@link ConsoleExporter} writes formatted lines to. Defaults to
 * the global `console`; injectable so tests can capture output without
 * monkey-patching the global. Only the two levels the exporter uses are
 * required.
 */
export type ConsoleLike = {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

/**
 * Options for {@link consoleExporter}.
 */
export type ConsoleExporterOptions = {
  /**
   * Where to write. Defaults to the global `console`. Inject a custom
   * sink in tests or to redirect to a structured logger.
   */
  console?: ConsoleLike;
  /**
   * Emit one indented line per span in the trace tree (`true`) instead
   * of a single summary line for the whole trace (`false`). Defaults to
   * `false` — one line per trace keeps long-running processes readable.
   */
  tree?: boolean;
  /**
   * Also print live `exportSpan` lines as each span finalizes. Defaults
   * to `false`; the collector only calls `exportSpan` when the method is
   * present, so leaving this off omits the method entirely.
   */
  streaming?: boolean;
  /**
   * Also print each span's captured content — `TraceSpan.input` /
   * `output` — as extra indented `in:` / `out:` lines beneath the span.
   * Defaults to `false`. Requires the collector to run with content
   * capture (`captureContent`); without it spans carry no content and
   * this is a no-op.
   */
  io?: boolean;
  /**
   * Max characters of captured content shown per `in:` / `out:` line
   * before truncation — only when {@link ConsoleExporterOptions.io} is on.
   * Defaults to `500`. Raise it for fuller payloads, or use the file
   * exporter for untruncated content.
   */
  ioMaxChars?: number;
};
