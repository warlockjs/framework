import type { DevtoolsAiResolvedRange } from "../../production/contracts";
import { DevtoolsApiError } from "../../production/errors";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_FILTER_LENGTH = 200;
const PRESETS = {
  "24h": { length: DAY_MS, step: HOUR_MS },
  "7d": { length: 7 * DAY_MS, step: 6 * HOUR_MS },
  "30d": { length: 30 * DAY_MS, step: DAY_MS },
} as const;

/** The query string the Reports, Models and Errors routes read. */
export type DevtoolsAiRangeQuery = {
  /** `24h` (default), `7d`, `30d` or `custom`. */
  range?: string;
  /** Epoch ms; required with `custom`. */
  from?: string;
  /** Epoch ms; required with `custom`. */
  to?: string;
  /** The browser's `-new Date().getTimezoneOffset()`: minutes east of UTC, -840 to 840. Default 0. */
  tz?: string;
  agent?: string;
  /** `provider/model`. */
  model?: string;
  provider?: string;
};

/** A parsed range plus the filters, ready for the service. */
export type DevtoolsAiReportQuery = {
  range: DevtoolsAiResolvedRange;
  previous: { from: number; to: number };
  /** `false` when part of the previous period is older than the kept history, so its totals are partial. */
  previousComplete: boolean;
  agent?: string;
  /** Split from `provider/model`. */
  model?: { provider: string; model: string };
  provider?: string;
};

/**
 * Parses and aligns a range:
 *
 * - `24h`: `to` = the next hour boundary after `now`, `from` = `to - 24h`, step 1 hour.
 * - `7d`: `to` as above, `from` = `to - 7d`, step 6 hours.
 * - `30d`: `to` = the next local midnight (by `tz`, rounded down to whole
 *   hours), `from` = `to - 30d`, step 1 day.
 * - `custom`: `from` floored and `to` ceiled to hours; at least 1 hour, `from`
 *   no older than `retentionDays`, `to` no later than the next hour; step 1
 *   hour up to 48 hours, 6 hours up to 8 days, else 1 day (then widened to
 *   local midnights, as for `30d`).
 *
 * `previous` is the same length just before `from`; `previousComplete` is
 * `false` when it starts before the retention cut-off. Filters longer than 200
 * characters, an unknown preset, a malformed number or a range outside the
 * rules throw `DevtoolsApiError("ai.range-invalid")`.
 */
export function parseAiReportQuery(
  query: DevtoolsAiRangeQuery,
  options: { now: number; retentionDays: number },
): DevtoolsAiReportQuery {
  const { now, retentionDays } = options;
  const utcOffsetMinutes = parseOffset(query.tz);
  const nextHour = (Math.floor(now / HOUR_MS) + 1) * HOUR_MS;
  // Whole-hour offsets only, so every day bucket starts on an hour boundary.
  const offsetMs = Math.floor(utcOffsetMinutes / 60) * HOUR_MS;
  const localMidnight = (at: number, round: (value: number) => number) =>
    round((at + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
  const preset = query.range === undefined || query.range === "" ? "24h" : query.range;
  let from: number;
  let to: number;
  let stepMs: number;

  if (preset === "24h" || preset === "7d") {
    to = nextHour;
    from = to - PRESETS[preset].length;
    stepMs = PRESETS[preset].step;
  } else if (preset === "30d") {
    to = (Math.floor((now + offsetMs) / DAY_MS) + 1) * DAY_MS - offsetMs;
    from = to - PRESETS["30d"].length;
    stepMs = PRESETS["30d"].step;
  } else if (preset === "custom") {
    const rawFrom = parseEpoch(query.from);
    const rawTo = parseEpoch(query.to);

    if (rawTo <= rawFrom) throw new DevtoolsApiError("ai.range-invalid");

    from = Math.floor(rawFrom / HOUR_MS) * HOUR_MS;
    to = Math.ceil(rawTo / HOUR_MS) * HOUR_MS;

    const oldest = Math.floor(now / HOUR_MS) * HOUR_MS - retentionDays * DAY_MS;

    if (from < oldest || to > nextHour) throw new DevtoolsApiError("ai.range-invalid");

    const length = to - from;

    stepMs = length <= 48 * HOUR_MS ? HOUR_MS : length <= 8 * DAY_MS ? 6 * HOUR_MS : DAY_MS;

    if (stepMs === DAY_MS) {
      // Day buckets are labelled by date, so they run from local midnight to local midnight
      // (the start no earlier than the kept history, the end at most the coming midnight).
      from = Math.max(localMidnight(from, Math.floor), localMidnight(oldest, Math.ceil));
      to = localMidnight(to, Math.ceil);
    }
  } else {
    throw new DevtoolsApiError("ai.range-invalid");
  }

  const agent = parseFilter(query.agent);
  const provider = parseFilter(query.provider);
  const modelKey = parseFilter(query.model);
  let model: DevtoolsAiReportQuery["model"];

  if (modelKey !== undefined) {
    // The provider is everything before the first slash; model names may contain slashes themselves.
    const slash = modelKey.indexOf("/");

    if (slash <= 0 || slash === modelKey.length - 1) throw new DevtoolsApiError("ai.range-invalid");

    model = { provider: modelKey.slice(0, slash), model: modelKey.slice(slash + 1) };
  }

  const previousFrom = from - (to - from);

  return {
    range: { preset, from, to, stepMs, utcOffsetMinutes },
    previous: { from: previousFrom, to: from },
    previousComplete: previousFrom >= Math.floor(now / HOUR_MS) * HOUR_MS - retentionDays * DAY_MS,
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
  };
}

function parseOffset(value: string | undefined): number {
  if (value === undefined || value === "") return 0;

  const offset = /^-?\d{1,4}$/.test(value) ? Number(value) : Number.NaN;

  if (!Number.isInteger(offset) || offset < -840 || offset > 840) {
    throw new DevtoolsApiError("ai.range-invalid");
  }

  return offset;
}

function parseEpoch(value: string | undefined): number {
  const epoch = value !== undefined && /^\d{1,15}$/.test(value) ? Number(value) : Number.NaN;

  if (!Number.isSafeInteger(epoch)) throw new DevtoolsApiError("ai.range-invalid");

  return epoch;
}

function parseFilter(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;

  if (value.length > MAX_FILTER_LENGTH) throw new DevtoolsApiError("ai.range-invalid");

  return value;
}
