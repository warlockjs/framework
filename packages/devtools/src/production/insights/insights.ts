import type { DevtoolsInstanceInfo, DevtoolsInstanceReport, DevtoolsLogRow } from "../contracts";
import {
  histogramMean,
  histogramQuantile,
  mergeErrorGroups,
  mergeQueryShapeStats,
  mergeRouteStats,
} from "../stats";
import type { DevtoolsStore } from "../store/types";
import type { DevtoolsInsightQuery, DevtoolsInsights, DevtoolsLocalReporter } from "./types";

export const DEFAULT_INSIGHT_LIMIT = 100;
export const MAX_INSIGHT_LIMIT = 500;

/** Reports fresher than this are merged into the views. */
const FRESH_MS = 60_000;
/** The instances list reaches back this far. */
const INSTANCES_MS = 5 * 60_000;

type ReportLoader = (windowMs: number) => Promise<DevtoolsInstanceReport[]>;

function limitOf(query: DevtoolsInsightQuery): number {
  const limit = query.limit ?? DEFAULT_INSIGHT_LIMIT;

  return Math.min(MAX_INSIGHT_LIMIT, Math.max(1, Math.floor(limit)));
}

function matches(value: string, needle: string | undefined): boolean {
  return !needle || value.toLowerCase().includes(needle.toLowerCase());
}

function infoOf(report: DevtoolsInstanceReport): DevtoolsInstanceInfo {
  return { ...report.instance, seenAt: report.at };
}

function build(load: ReportLoader, sampleRateOf: (reports: DevtoolsInstanceReport[]) => number) {
  /** The fresh reports of the selected instance(s). */
  async function select(
    query: DevtoolsInsightQuery,
    windowMs = FRESH_MS,
  ): Promise<DevtoolsInstanceReport[]> {
    const reports = await load(windowMs);

    return query.instance === "all"
      ? reports
      : reports.filter((report) => report.instance.id === query.instance);
  }

  const insights: DevtoolsInsights = {
    async instances() {
      const reports = await load(INSTANCES_MS);
      const infos = reports.map(infoOf).sort((a, b) => b.seenAt - a.seenAt);

      return { current: current(reports), instances: infos };
    },

    async resources(query) {
      const reports = await select(query);

      return {
        instances: reports.map((report) => ({
          instance: infoOf(report),
          snapshot: report.resources.snapshot,
          history: report.resources.history,
        })),
      };
    },

    async queryStats(query) {
      const reports = await select(query);
      const sort = query.sort ?? "total";
      const rows = mergeQueryShapeStats(
        reports.map((report) => ({ instance: report.instance.id, shapes: report.queries })),
      ).map((shape) => ({
        ...shape,
        p50Ms: histogramQuantile(shape.histogram, 0.5),
        p95Ms: histogramQuantile(shape.histogram, 0.95),
        meanMs: histogramMean(shape.histogram),
      }));

      const key: Record<string, (row: (typeof rows)[number]) => number> = {
        total: (row) => row.histogram.sumMs,
        p95: (row) => row.p95Ms,
        count: (row) => row.count,
        "n+1": (row) => row.nPlusOne.requests * 1e6 + row.nPlusOne.maxPerRequest,
      };
      const by = key[sort] ?? key.total!;

      return {
        shapes: rows.sort((a, b) => by(b) - by(a)).slice(0, limitOf(query)),
        sampleRate: sampleRateOf(reports),
        instanceCount: reports.length,
        evicted: reports.reduce((sum, report) => sum + report.capture.evictedShapes, 0),
      };
    },

    async routeStats(query) {
      const reports = await select(query);
      const sort = query.sort ?? "total";
      const rows = mergeRouteStats(
        reports.map((report) => ({ instance: report.instance.id, routes: report.routes })),
      ).map((route) => ({
        ...route,
        p50Ms: histogramQuantile(route.histogram, 0.5),
        p95Ms: histogramQuantile(route.histogram, 0.95),
        meanMs: histogramMean(route.histogram),
      }));

      const key: Record<string, (row: (typeof rows)[number]) => number> = {
        total: (row) => row.histogram.sumMs,
        p95: (row) => row.p95Ms,
        count: (row) => row.count,
        errors: (row) => row.errors,
      };
      const by = key[sort] ?? key.total!;

      return {
        routes: rows.sort((a, b) => by(b) - by(a)).slice(0, limitOf(query)),
        sampleRate: sampleRateOf(reports),
        instanceCount: reports.length,
      };
    },

    async health(query) {
      const reports = await select(query);

      return {
        instances: reports.map((report) => ({ instance: infoOf(report), report: report.health })),
      };
    },

    async errors(query) {
      const reports = await select(query);
      const groups = mergeErrorGroups(
        reports.map((report) => ({ instance: report.instance.id, errors: report.errors })),
      );

      return { groups: groups.slice(0, limitOf(query)) };
    },

    async logs(query) {
      const reports = await select(query);
      const rows: DevtoolsLogRow[] = [];

      for (const report of reports) {
        for (const entry of report.logs) {
          if (!matches(entry.level, query.level) || !matches(entry.module, query.module)) continue;

          rows.push({ ...entry, instance: report.instance.id });
        }
      }

      return rows.sort((a, b) => b.at - a.at).slice(0, limitOf(query));
    },

    async jobs(query) {
      const reports = await select(query);

      return {
        instances: reports.map((report) => ({ instance: infoOf(report), report: report.jobs })),
      };
    },
  };

  let currentId = "";

  function current(reports: DevtoolsInstanceReport[]): string {
    return currentId || reports[0]?.instance.id || "";
  }

  return {
    insights,
    setCurrent(id: string) {
      currentId = id;
    },
  };
}

/** The sample rate the counts come from: the lowest any selected instance used (1 when none). */
function lowestRate(reports: DevtoolsInstanceReport[]): number {
  return reports.length === 0 ? 1 : Math.min(...reports.map((r) => r.capture.sampleRate));
}

/** Development insights: this process only. */
export function createLocalInsights(reporter: DevtoolsLocalReporter): DevtoolsInsights {
  const { insights, setCurrent } = build(async () => [await reporter.snapshot()], lowestRate);

  setCurrent(reporter.instance.id);

  return insights;
}

/** Production insights: merged instance reports from the store plus this process live. */
export function createSharedInsights(input: {
  store: DevtoolsStore;
  reporter: DevtoolsLocalReporter;
  sampleRate: number;
}): DevtoolsInsights {
  const { store, reporter, sampleRate } = input;

  const { insights, setCurrent } = build(
    async (windowMs) => {
      const live = await reporter.snapshot();
      let stored: DevtoolsInstanceReport[] = [];

      try {
        stored = await store.reports.list(live.at - windowMs);
      } catch {
        // The database is unreachable: show this process alone rather than nothing.
      }

      // The answering instance is always taken live, never from its stored row.
      return [live, ...stored.filter((report) => report.instance.id !== live.instance.id)];
    },
    () => sampleRate,
  );

  setCurrent(reporter.instance.id);

  return insights;
}
