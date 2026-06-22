/**
 * Type contracts for the utility tools — `ai.tools.calculator` and
 * `ai.tools.dateTime`. Pure declarations only; the factories live
 * outside `contracts/`.
 */

/**
 * Construction options for `ai.tools.calculator`.
 */
export interface CalculatorOptions {
  /**
   * Override the tool name exposed to the LLM.
   *
   * @default "calculator"
   */
  name?: string;
}

/**
 * The validated input shape the model passes to `calculator`.
 */
export interface CalculatorInput {
  /** An arithmetic expression to evaluate, e.g. `"(3 + 4) * 2"`. */
  expression: string;
}

/**
 * The `calculator` tool's output.
 */
export interface CalculatorResult {
  /** The numeric result of evaluating the expression. */
  result: number;
}

/**
 * The operations `ai.tools.dateTime` can perform.
 *
 * - `"now"` — current date-time, optionally in a given time zone.
 * - `"add"` — add `amount` of `unit` to `iso`.
 * - `"diff"` — difference between two instants, in `unit`.
 * - `"format"` — render `iso` per `format`.
 */
export type DateTimeOp = "now" | "add" | "diff" | "format";

/**
 * Construction options for `ai.tools.dateTime`.
 */
export interface DateTimeOptions {
  /**
   * Override the tool name exposed to the LLM.
   *
   * @default "date_time"
   */
  name?: string;
  /**
   * Default IANA time zone applied when a call omits `timeZone`
   * (e.g. `"UTC"`, `"Africa/Cairo"`). When unset, the host time zone
   * is used.
   */
  defaultTimeZone?: string;
}

/**
 * The validated input shape the model passes to `date_time`. Which
 * fields are required depends on `op` (validated at the seal layer).
 */
export interface DateTimeInput {
  /** Which date-time operation to perform. */
  op: DateTimeOp;
  /** ISO-8601 instant the operation acts on (`add` / `diff` / `format`). */
  iso?: string;
  /** Second ISO-8601 instant for `diff`. */
  to?: string;
  /** Signed magnitude for `add`. */
  amount?: number;
  /** Unit for `add` / `diff`, e.g. `"days"`, `"hours"`, `"minutes"`. */
  unit?: string;
  /** IANA time zone override for this call. */
  timeZone?: string;
  /** Output format string for `format` (and the rendered `now`). */
  format?: string;
}

/**
 * The `date_time` tool's output.
 */
export interface DateTimeResult {
  /**
   * The result, rendered as a string — an ISO instant, a formatted
   * date, or a stringified numeric difference depending on `op`.
   */
  value: string;
}
