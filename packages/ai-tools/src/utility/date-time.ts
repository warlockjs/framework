import { tool, type ToolContract } from "@warlock.js/ai";
import { DateTimeError } from "../errors";
import { literalField, objectSchema, optionalNumberField, optionalStringField } from "./schema";
import type {
  DateTimeInput,
  DateTimeOp,
  DateTimeOptions,
  DateTimeResult,
} from "../contracts/utility.type";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "date_time";

/** The closed set of operations the tool implements. */
const OPS: readonly DateTimeOp[] = ["now", "add", "diff", "format"];

/**
 * A clock seam so tests are deterministic. Defaults to the real
 * {@link Date}; a test injects a fixed instant. Returns milliseconds
 * since the Unix epoch — the same contract as `Date.now()`.
 */
export type Clock = () => number;

/** Construction dependencies for {@link dateTimeTool}, all optional. */
export interface DateTimeToolDeps {
  /**
   * The clock used by the `now` op. Defaults to `Date.now`. Injected in
   * tests for deterministic output.
   */
  clock?: Clock;
}

/** Input schema for the `date_time` tool. */
const inputSchema = objectSchema<DateTimeInput>({
  op: literalField<DateTimeOp>(OPS),
  iso: optionalStringField(),
  from: optionalStringField(),
  to: optionalStringField(),
  amount: optionalNumberField(),
  unit: optionalStringField(),
  timeZone: optionalStringField(),
  format: optionalStringField(),
});

/**
 * The time units `add` and `diff` understand, each as its length in
 * milliseconds. Calendar-unaware on purpose: a "month" / "year" has no
 * fixed millisecond length, so they are deliberately excluded — adding
 * `30 days` is unambiguous in a way adding `1 month` is not.
 */
const UNIT_MS: Record<string, number> = {
  milliseconds: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

/** Singular aliases mapped to their canonical plural unit key. */
const UNIT_ALIASES: Record<string, string> = {
  millisecond: "milliseconds",
  ms: "milliseconds",
  second: "seconds",
  sec: "seconds",
  s: "seconds",
  minute: "minutes",
  min: "minutes",
  m: "minutes",
  hour: "hours",
  hr: "hours",
  h: "hours",
  day: "days",
  d: "days",
  week: "weeks",
  w: "weeks",
};

/** Resolve a (possibly aliased / singular) unit token to its ms length. */
function unitToMs(unit: string): number {
  const canonical = UNIT_ALIASES[unit] ?? unit;
  const ms = UNIT_MS[canonical];

  if (ms === undefined) {
    throw new DateTimeError(
      `Unknown unit "${unit}". Supported units: ${Object.keys(UNIT_MS).join(", ")}.`,
      { type: "invalid-unit" },
    );
  }

  return ms;
}

/**
 * Parse an ISO-8601 instant into a {@link Date}, or throw a typed
 * {@link DateTimeError} when the string is missing or unparseable.
 *
 * @param iso - The ISO string from the model (may be undefined).
 * @param field - The input field name, for the error message.
 */
function parseIso(iso: string | undefined, field: string): Date {
  if (iso === undefined) {
    throw new DateTimeError(`"${field}" is required for this operation.`, {
      type: "invalid-input",
    });
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    throw new DateTimeError(`"${field}" is not a valid ISO-8601 instant: "${iso}".`, {
      type: "invalid-input",
    });
  }

  return date;
}

/**
 * Render a {@link Date} in a target time zone using `Intl`. The
 * `"iso"` format (the default) returns the instant's UTC ISO string;
 * any other `format` value is treated as an `Intl.DateTimeFormat`
 * locale-style rendering in the given `timeZone`.
 *
 * @throws DateTimeError `type: "invalid-time-zone"` when `timeZone` is
 *   not a recognized IANA zone.
 */
function render(date: Date, format: string | undefined, timeZone: string | undefined): string {
  if (format === undefined || format === "iso") {
    // `timeZone` is irrelevant to a UTC ISO string, but validate it when
    // supplied so a bad zone is reported rather than silently ignored.
    if (timeZone !== undefined) {
      assertTimeZone(timeZone);
    }

    return date.toISOString();
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      dateStyle: format === "date" ? "medium" : undefined,
      timeStyle: format === "time" ? "medium" : undefined,
      ...(format === "datetime" ? { dateStyle: "medium", timeStyle: "medium" } : {}),
    }).format(date);
  } catch (error) {
    throw new DateTimeError(
      `Could not render with format "${format}"${timeZone ? ` in time zone "${timeZone}"` : ""}.`,
      { type: "invalid-time-zone", cause: error },
    );
  }
}

/**
 * Validate an IANA time zone by attempting to construct a formatter for
 * it; an unrecognized zone makes `Intl` throw a `RangeError`.
 *
 * @throws DateTimeError `type: "invalid-time-zone"` for an unknown zone.
 */
function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch (error) {
    throw new DateTimeError(`Unknown time zone "${timeZone}".`, {
      type: "invalid-time-zone",
      cause: error,
    });
  }
}

/**
 * Build the `date_time` tool — a small clock/calendar utility the agent
 * can call to read the current instant, shift an instant, measure the
 * gap between two instants, or render one. The `op` discriminator selects
 * the operation:
 *
 * - **`now`** — the current instant, rendered per `format` / `timeZone`
 *   (defaults to a UTC ISO string). Reads the injectable {@link Clock}.
 * - **`add`** — `iso` shifted by `amount` of `unit` (e.g.
 *   `+3 days`); a negative `amount` shifts backward.
 * - **`diff`** — the signed difference `to − iso`, expressed in `unit`.
 * - **`format`** — `iso` rendered per `format` / `timeZone`.
 *
 * Units are millisecond-based (`milliseconds`…`weeks`, plus common
 * aliases); calendar-relative `month`/`year` are intentionally
 * unsupported because they have no fixed length.
 *
 * **Deterministic in tests.** The clock backing `now` is injectable via
 * `deps.clock`; production defaults to `Date.now`.
 *
 * **Errors flow as data.** A missing/invalid field, an unknown unit, or
 * an unrecognized time zone throws a {@link DateTimeError} inside the
 * handler; `tool()` surfaces it in `{ error }` so the agent self-corrects.
 *
 * @param options - Optional overrides; `name` renames the tool,
 *   `defaultTimeZone` applies when a call omits `timeZone`.
 * @param deps - Injectable dependencies (the {@link Clock}); defaults to real time.
 * @returns A `ToolContract<DateTimeInput, { value }>` ready for `tools: []`.
 *
 * @example
 * const clock = () => Date.parse("2026-06-22T00:00:00Z");
 * const dt = dateTimeTool({}, { clock });
 * const { data } = await dt.invoke({ op: "now" });
 * console.log(data?.value); // "2026-06-22T00:00:00.000Z"
 */
export function dateTimeTool(
  options?: DateTimeOptions,
  deps?: DateTimeToolDeps,
): ToolContract<DateTimeInput, DateTimeResult> {
  const clock: Clock = deps?.clock ?? Date.now;
  const defaultTimeZone = options?.defaultTimeZone;

  return tool<DateTimeInput, DateTimeResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      'Work with dates and times. Set op to: "now" (current instant), ' +
      '"add" (shift iso by amount of unit), "diff" (signed to − from in unit; ' +
      "pass the start instant as iso or from), " +
      'or "format" (render iso). Units are milliseconds, seconds, minutes, ' +
      "hours, days, or weeks (month/year are not supported). Pass instants as " +
      'ISO-8601 strings; set format to "iso" (default), "date", "time", or ' +
      '"datetime", and timeZone as an IANA zone like "Africa/Cairo".',
    input: inputSchema,
    async execute(input) {
      const timeZone = input.timeZone ?? defaultTimeZone;

      switch (input.op) {
        case "now": {
          const date = new Date(clock());

          return { value: render(date, input.format, timeZone) };
        }

        case "format": {
          const date = parseIso(input.iso, "iso");

          return { value: render(date, input.format, timeZone) };
        }

        case "add": {
          const date = parseIso(input.iso, "iso");

          if (input.amount === undefined) {
            throw new DateTimeError('"amount" is required for the "add" operation.', {
              type: "invalid-input",
            });
          }

          if (input.unit === undefined) {
            throw new DateTimeError('"unit" is required for the "add" operation.', {
              type: "invalid-input",
            });
          }

          const shifted = new Date(date.getTime() + input.amount * unitToMs(input.unit));

          return { value: render(shifted, input.format, timeZone) };
        }

        case "diff": {
          // Accept `from` as an alias for `iso` — models naturally pass
          // `from` / `to` for a difference. `iso` wins when both are set.
          const from = parseIso(input.iso ?? input.from, "iso (or from)");
          const to = parseIso(input.to, "to");

          if (input.unit === undefined) {
            throw new DateTimeError('"unit" is required for the "diff" operation.', {
              type: "invalid-input",
            });
          }

          const diff = (to.getTime() - from.getTime()) / unitToMs(input.unit);

          return { value: String(diff) };
        }

        default: {
          // Exhaustiveness guard — the schema's literal union should make
          // this unreachable, but a future op added to the union without a
          // case here surfaces as typed data rather than silent fallthrough.
          const unreachable: never = input.op;

          throw new DateTimeError(`Unsupported operation "${String(unreachable)}".`, {
            type: "unsupported-op",
          });
        }
      }
    },
  });
}
