import type {
  DevtoolsAiErrorsView,
  DevtoolsAiFailedRun,
  DevtoolsAiModelsView,
  DevtoolsAiReportView,
} from "../../production/contracts";
import type { DevtoolsAiRollupDelta, DevtoolsAiRollupStore } from "../types";
import {
  breakdown,
  errorGroups,
  errorRateSeries,
  errorSeries,
  filterOptions,
  modelRows,
  seriesBy,
  tokenSeries,
  totalsOf,
} from "./aggregate";
import { type DevtoolsAiRangeQuery, type DevtoolsAiReportQuery, parseAiReportQuery } from "./range";
import type { DevtoolsAiRecentFailuresFilter } from "./runs";

const CACHE_MS = 15_000;
const MAX_CACHE_ENTRIES = 20;
const TOP_LIMIT = 10;
const RECENT_LIMIT = 50;

/** What the report service reads. */
export type DevtoolsAiReportServiceInput = {
  store: DevtoolsAiRollupStore;
  /** The writer's unsaved deltas, added to the stored rows. */
  pending: () => DevtoolsAiRollupDelta[];
  retentionDays: number;
  observationOff: () => boolean;
  /**
   * Development: recent failed runs from the trace store, newest first, scoped
   * to the page's range and filters; absent in production (`recent: null`).
   */
  recentFailures?: (filter: DevtoolsAiRecentFailuresFilter) => DevtoolsAiFailedRun[];
  now?: () => number;
};

/**
 * Answers the Reports, Models and Errors routes. Each call parses the query
 * (`parseAiReportQuery`, which throws `ai.range-invalid`), lists the stored
 * rows of the range (and of the previous period where the view needs it),
 * adds the matching pending deltas, and folds them with `aggregate.ts`.
 * Answers are cached for 15 seconds per query (at most 20 entries).
 */
export type DevtoolsAiReportService = {
  report(query: DevtoolsAiRangeQuery): Promise<DevtoolsAiReportView>;
  models(query: DevtoolsAiRangeQuery): Promise<DevtoolsAiModelsView>;
  errors(query: DevtoolsAiRangeQuery): Promise<DevtoolsAiErrorsView>;
};

export function createAiReportService(
  input: DevtoolsAiReportServiceInput,
): DevtoolsAiReportService {
  const now = input.now ?? Date.now;
  const cache = new Map<string, { at: number; value: unknown }>();

  /** The rows of the previous period and the range, stored plus unsaved, before the filters. */
  async function load(parsed: DevtoolsAiReportQuery): Promise<{
    rows: DevtoolsAiRollupDelta[];
    previousRows: DevtoolsAiRollupDelta[];
    scoped: DevtoolsAiRollupDelta[];
  }> {
    const { range, previous } = parsed;
    const stored: DevtoolsAiRollupDelta[] = await input.store.list({
      fromHour: previous.from,
      toHour: range.to,
    });
    const all = [...stored, ...input.pending()].filter(
      (row) => row.hour >= previous.from && row.hour < range.to,
    );
    const inRange = all.filter((row) => row.hour >= range.from);
    const matches = (row: DevtoolsAiRollupDelta): boolean =>
      (parsed.agent === undefined || row.agent === parsed.agent) &&
      (parsed.provider === undefined || row.provider === parsed.provider) &&
      (parsed.model === undefined ||
        (row.provider === parsed.model.provider && row.model === parsed.model.model));

    return {
      // Unfiltered rows of the range: the filter row offers every value that exists, not only the chosen ones.
      rows: inRange,
      previousRows: all.filter((row) => row.hour < range.from && matches(row)),
      scoped: inRange.filter(matches),
    };
  }

  /** Parses first (so a bad range throws and is never cached), then answers from the cache or `build`. */
  async function answer<T>(
    view: string,
    query: DevtoolsAiRangeQuery,
    build: (parsed: DevtoolsAiReportQuery) => Promise<T>,
  ): Promise<T> {
    const at = now();
    const parsed = parseAiReportQuery(query, { now: at, retentionDays: input.retentionDays });
    const key = `${view}|${JSON.stringify([
      query.range ?? "",
      query.from ?? "",
      query.to ?? "",
      query.tz ?? "",
      query.agent ?? "",
      query.model ?? "",
      query.provider ?? "",
    ])}`;
    const cached = cache.get(key);

    if (cached && at - cached.at < CACHE_MS) return cached.value as T;

    const value = await build(parsed);

    cache.delete(key);
    cache.set(key, { at, value });

    for (const oldest of cache.keys()) {
      if (cache.size <= MAX_CACHE_ENTRIES) break;

      cache.delete(oldest);
    }

    return value;
  }

  return {
    report: (query) =>
      answer("report", query, async (parsed) => {
        const { rows, previousRows, scoped } = await load(parsed);
        const { range } = parsed;
        const unpriced = new Set<string>();

        for (const row of scoped) {
          if (row.unpricedRuns > 0) unpriced.add(`${row.provider}/${row.model}`);
        }

        return {
          available: true as const,
          range,
          previousRange: parsed.previous,
          previousComplete: parsed.previousComplete,
          totals: totalsOf(scoped),
          previous: totalsOf(previousRows),
          costByModel: seriesBy(
            scoped,
            range,
            (row) => `${row.provider}/${row.model}`,
            (key) => key,
            (row) => row.costUsd,
          ),
          tokens: tokenSeries(scoped, range),
          errorRate: errorRateSeries(scoped, range),
          topAgents: breakdown(scoped, "agent", TOP_LIMIT),
          topModels: breakdown(scoped, "model", TOP_LIMIT),
          unpricedModels: [...unpriced].sort(),
          filters: filterOptions(rows),
          observationOff: input.observationOff(),
          generatedAt: now(),
        };
      }),

    models: (query) =>
      answer("models", query, async (parsed) => {
        const { rows, scoped } = await load(parsed);

        return {
          available: true as const,
          range: parsed.range,
          totals: totalsOf(scoped),
          models: modelRows(scoped),
          runsByModel: seriesBy(
            scoped,
            parsed.range,
            (row) => `${row.provider}/${row.model}`,
            (key) => key,
            (row) => row.runs,
          ),
          filters: filterOptions(rows),
          observationOff: input.observationOff(),
          generatedAt: now(),
        };
      }),

    async errors(query) {
      const view = await answer("errors", query, async (parsed) => {
        const { rows, previousRows, scoped } = await load(parsed);

        return {
          available: true as const,
          range: parsed.range,
          totals: totalsOf(scoped),
          previous: totalsOf(previousRows),
          previousComplete: parsed.previousComplete,
          groups: errorGroups(scoped, previousRows),
          overTime: errorSeries(scoped, parsed.range),
          recent: null,
          filters: filterOptions(rows),
          observationOff: input.observationOff(),
          generatedAt: now(),
        };
      });

      if (!input.recentFailures) return view;

      // Recent failures are read fresh (a failed run shows at once) and scoped like every other table.
      const { range, agent, provider, model } = parseAiReportQuery(query, {
        now: now(),
        retentionDays: input.retentionDays,
      });

      return {
        ...view,
        recent: input
          .recentFailures({
            from: range.from,
            to: range.to,
            ...(agent === undefined ? {} : { agent }),
            ...(provider === undefined ? {} : { provider }),
            ...(model === undefined ? {} : { model }),
          })
          .slice(0, RECENT_LIMIT),
      };
    },
  };
}
