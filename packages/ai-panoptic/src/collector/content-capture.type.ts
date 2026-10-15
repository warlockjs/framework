import type { ReportType } from "@warlock.js/ai";

/**
 * Masker applied to each captured content value before it lands on a
 * span's `input` / `output`. Receives the raw value plus which node and
 * field it came from; return the (possibly masked) value to store, or
 * `undefined` to drop the field entirely. Use it to strip secrets / PII
 * when content capture runs in a sensitive environment.
 *
 * @example
 * const redactContent: ContentRedactor = (value, { field }) =>
 *   field === "input" ? "[redacted prompt]" : value;
 */
export type ContentRedactor = (
  value: unknown,
  meta: { name: string; type: ReportType; field: "input" | "output" },
) => unknown;

/**
 * Opt-in content capture for the report → trace projection. Off by
 * default: span `input` / `output` stay absent because prompts,
 * completions, and tool payloads are large and frequently sensitive.
 *
 * Enable it on the collector ({@link
 * import("./collector").createCollector}) or the subscriber ({@link
 * import("../panoptic/panoptic").panoptic}) to flow content into every
 * exporter — `consoleExporter({ io: true })`, the file exporter's JSON,
 * OTel `gen_ai.prompt` / `gen_ai.completion`, and Langfuse
 * `input` / `output`.
 */
export type ContentCaptureOptions = {
  /**
   * Copy the agent's first-trip prompt + final response, and each tool's
   * args + result, onto `span.input` / `span.output`. Default `false`.
   */
  captureContent?: boolean;
  /** Optional masker applied to every captured value before it is stored. */
  redactContent?: ContentRedactor;
  /**
   * When `true`, emit the agent's complete `CapturedMessage[]` (every
   * trip, every role) onto `span.input` instead of the `[system, user]`
   * first-trip array. Requires the upstream run to set `captureMessages`
   * (core `@warlock.js/ai`) so the report carries a `messages` array — a
   * no-op falling back to first-trip capture when it doesn't. The whole
   * array is still passed through the {@link ContentRedactor} as a single
   * value, so masking applies to captured history too. Default `false`.
   */
  fullHistory?: boolean;
};
