import path from "node:path";
import type { DevtoolsAiFailedRun, DevtoolsAiUnavailableView } from "../production/contracts";
import { describeAiUnavailable, loadAiPackages, toAiUnavailableView } from "../sources/ai-source";
import { createAiReportService, type DevtoolsAiReportService } from "./reports/service";
import type { DevtoolsAiRecentFailuresFilter, DevtoolsAiRunHelpers } from "./reports/runs";
import { createCascadeAiRollupStore, createFileAiRollupStore, startAiRollupWriter } from "./rollup";
import type {
  DevtoolsAiFeed,
  DevtoolsAiRollupStore,
  DevtoolsAiRollupWriter,
  ResolvedDevtoolsAiOptions,
} from "./types";

/** The AI reports wiring of one process, as the routes receive it. */
export type DevtoolsAiReports =
  | {
      available: true;
      service: DevtoolsAiReportService;
      writer: DevtoolsAiRollupWriter;
      dispose(): Promise<void>;
    }
  | (DevtoolsAiUnavailableView & { dispose(): Promise<void> });

/**
 * Loads Panoptic's trace feed (`subscribeTraces`, `totalCostUsd`) and
 * `@warlock.js/ai`'s observer registry lazily, plus the Runs helpers. Returns
 * `{ unavailable }` (`ai-missing`, `panoptic-missing`, `panoptic-failed`)
 * when they do not load. Shared by the development and production wiring.
 */
export async function loadAiFeed(deps?: {
  load?: (name: string) => Promise<unknown>;
  version?: (name: string) => string | null;
}): Promise<
  | { feed: DevtoolsAiFeed; helpers: DevtoolsAiRunHelpers }
  | { unavailable: DevtoolsAiUnavailableView }
> {
  const loaded = await loadAiPackages(deps);

  if ("unavailable" in loaded) return { unavailable: toAiUnavailableView(loaded.unavailable) };

  const { panoptic, observationOff } = loaded;

  return {
    feed: {
      subscribe: (listener) => panoptic.subscribeTraces(listener),
      totalCost: (usage) => panoptic.totalCostUsd(usage),
      observationOff,
    },
    helpers: {
      filterTraces: panoptic.filterTraces,
      groupBySession: panoptic.groupBySession,
      groupByPrompt: panoptic.groupByPrompt,
      groupByType: panoptic.groupByType,
      percentile: panoptic.percentile,
      tracePromptKey: panoptic.tracePromptKey,
    },
  };
}

const TABLE_MISSING_WARNING =
  "AI reports are off: the devtools_ai_rollups table is missing. Run the devtools migrations (warlock migrate), then restart.";

/**
 * Starts the AI reports of this process: with `options.reports` off answers
 * `reports-off`; otherwise builds the store for the mode (development: the
 * file store in `directory`; production: the cascade store, `table-missing`
 * when `verify()` is false, logged once with the migration hint), starts the
 * rollup writer on `feed.subscribe`, and builds the report service.
 * `dispose` unsubscribes and stops the writer (final flush).
 */
export async function attachAiReports(input: {
  feed: DevtoolsAiFeed;
  options: ResolvedDevtoolsAiOptions;
  /** Development only: where the file store writes (core's `storagePath("devtools/ai-rollups")`). */
  directory?: string;
  /** Development only: recent failures from the Runs store, scoped to a page's range and filters. */
  recentFailures?: (filter: DevtoolsAiRecentFailuresFilter) => DevtoolsAiFailedRun[];
  warn: (message: string) => void;
}): Promise<DevtoolsAiReports> {
  const { feed, options, warn } = input;
  const off = (reason: "reports-off" | "table-missing"): DevtoolsAiReports => ({
    ...toAiUnavailableView(describeAiUnavailable(reason)),
    async dispose() {},
  });

  if (!options.reports) return off("reports-off");

  const production = options.mode === "production";
  let store: DevtoolsAiRollupStore;

  try {
    store = production
      ? await createCascadeAiRollupStore()
      : createFileAiRollupStore({
          directory:
            input.directory ?? path.join(process.cwd(), "storage", "devtools", "ai-rollups"),
        });

    if (!(await store.verify())) {
      warn(TABLE_MISSING_WARNING);

      return off("table-missing");
    }
  } catch (error) {
    warn(`${TABLE_MISSING_WARNING} (${error instanceof Error ? error.message : String(error)})`);

    return off("table-missing");
  }

  const writer = startAiRollupWriter({ store, totalCost: feed.totalCost, options, warn });
  const unsubscribe = feed.subscribe((trace) => writer.record(trace));
  const service = createAiReportService({
    store,
    pending: () => writer.pending(),
    retentionDays: options.retentionDays,
    observationOff: () => feed.observationOff(),
    ...(input.recentFailures ? { recentFailures: input.recentFailures } : {}),
  });

  return {
    available: true,
    service,
    writer,
    async dispose() {
      unsubscribe();
      await writer.stop();
    },
  };
}

/** The global key devtools publishes once mounted, read by Panoptic to keep its own dashboard off. */
export const DEVTOOLS_MOUNTED_KEY = Symbol.for("@warlock.js/devtools.mounted");

/** What is published under `DEVTOOLS_MOUNTED_KEY`. */
export type DevtoolsMountedMarker = { path: string; mode: "development" | "production" };
