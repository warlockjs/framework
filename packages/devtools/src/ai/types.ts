import type { Trace } from "@warlock.js/ai-panoptic";
import type { DevtoolsAiErrorCategory, DevtoolsMode } from "../production/contracts";

/**
 * Server-side types of the AI section: the hourly rollups, their stores and
 * writer, and the options. The JSON the routes answer with lives in
 * `production/contracts.ts` (the dashboard imports it).
 */

/** `devtools.ai` in `src/config/devtools.ts`. */
export type DevtoolsAiOptions = {
  /**
   * Keep hourly AI totals (runs, tokens, estimated cost, errors, latency) for
   * the Reports, Models and Errors pages.
   * @default true
   */
  reports?: boolean;
  /**
   * Days of hourly totals kept; older hours are removed every 10 minutes.
   * A whole number from 1 to 400.
   * @default 30 in development, 90 in production
   */
  retentionDays?: number;
  /**
   * How often totals not yet saved are written, in ms. At least 5000.
   * @default 60000
   */
  flushIntervalMs?: number;
};

/** `devtools.ai` with every default applied for one mode. */
export type ResolvedDevtoolsAiOptions = {
  reports: boolean;
  retentionDays: number;
  flushIntervalMs: number;
  mode: DevtoolsMode;
};

/** The dimensions of one hourly rollup row. */
export type DevtoolsAiRollupKey = {
  /** Start of the UTC hour the runs ended in (epoch ms). */
  hour: number;
  /** The agent span's name, at most 200 characters; `(unknown)` when empty. */
  agent: string;
  /** The model name, at most 200 characters; `(unknown)` when unreported. */
  model: string;
  /** The provider, at most 100 characters; `(unknown)` when unreported. */
  provider: string;
};

/** Error counts by category; every category is present (0 when none). */
export type DevtoolsAiErrorCounts = Record<DevtoolsAiErrorCategory, number>;

/** The counters of one rollup row; every field adds up across processes. */
export type DevtoolsAiRollupCounters = {
  runs: number;
  completed: number;
  failed: number;
  /** `incomplete` and `max-iterations`. */
  incomplete: number;
  cancelled: number;
  /** Whole prompt, cache reads and writes included (normalised from `inputIncludesCache: false`). */
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** Estimated USD of the priced runs only. */
  costUsd: number;
  pricedRuns: number;
  /** Runs that used tokens on a model without pricing. */
  unpricedRuns: number;
  /** Input plus output tokens of the unpriced runs. */
  unpricedTokens: number;
  fallbackRuns: number;
  refusals: number;
  /** Failed and incomplete runs by category (a run counts in exactly one). */
  errors: DevtoolsAiErrorCounts;
  /** `DEVTOOLS_AI_LATENCY_BUCKETS_MS.length + 1` counts. */
  latency: number[];
  latencyCount: number;
  latencySumMs: number;
};

/** What one process adds to a row between two flushes. */
export type DevtoolsAiRollupDelta = DevtoolsAiRollupKey & DevtoolsAiRollupCounters;

/** A stored row (table/collection `devtools_ai_rollups`, or a development file). */
export type DevtoolsAiRollupRecord = DevtoolsAiRollupDelta & {
  /** `rollupId(key)`: first 40 hex characters of SHA-256 over `hour|agent|model|provider`. */
  id: string;
  updatedAt: number;
};

/** Filter of `DevtoolsAiRollupStore.list`. */
export type DevtoolsAiRollupFilter = {
  /** Inclusive hour start. */
  fromHour: number;
  /** Exclusive hour start. */
  toHour: number;
  agent?: string;
  model?: string;
  provider?: string;
};

/**
 * Where the hourly rollups live. Three implementations: the app database
 * (`createCascadeAiRollupStore`, production), JSON files under the app's
 * storage folder (`createFileAiRollupStore`, development) and memory
 * (`createMemoryAiRollupStore`, specs). `increment` adds counters, so every
 * process of a deployment writes into the same rows without coordination.
 */
export interface DevtoolsAiRollupStore {
  /** `false` when the table (or folder) is missing; never throws for that. */
  verify(): Promise<boolean>;
  /**
   * Adds each delta to its row, creating the row when it does not exist.
   * When only some deltas were saved it throws `DevtoolsAiRollupIncrementError`
   * listing the unsaved ones; any other error means nothing was saved.
   */
  increment(deltas: readonly DevtoolsAiRollupDelta[]): Promise<void>;
  /** Rows of the filter, any order. */
  list(filter: DevtoolsAiRollupFilter): Promise<DevtoolsAiRollupRecord[]>;
  /** Removes rows whose hour is before `beforeHour`; returns how many. */
  prune(beforeHour: number): Promise<number>;
}

/** Totals a trace's priced usage the same way Panoptic does (`totalCostUsd`). */
export type DevtoolsAiTotalCost = (usage: Trace["usage"]) => number | undefined;

/** Turns finished traces into rollup deltas and writes them on a timer. */
export type DevtoolsAiRollupWriter = {
  /** Adds one finished trace; synchronous and never throws. */
  record(trace: Trace): void;
  /** Deltas not written yet (the report service adds them, so a run shows at once). */
  pending(): DevtoolsAiRollupDelta[];
  /** Writes the pending deltas now; a failed write keeps them for the next try. */
  flush(): Promise<void>;
  /** Stops the timers and writes what is pending (gives up after 5 s). */
  stop(): Promise<void>;
};

/** What `startAiRollupWriter` needs. */
export type DevtoolsAiRollupWriterInput = {
  store: DevtoolsAiRollupStore;
  totalCost: DevtoolsAiTotalCost;
  options: ResolvedDevtoolsAiOptions;
  now?: () => number;
  /** Receives a failed write or prune, at most once a minute. */
  warn?: (message: string) => void;
  /** Distinct keys kept in memory between flushes; past it new keys fold into agent `(other)`. @default 2000 */
  maxKeys?: number;
};

/** The AI feed devtools attaches in either mode (see `src/ai/attach.ts`). */
export type DevtoolsAiFeed = {
  /** Subscribes to every finished Panoptic trace; returns the unsubscribe. */
  subscribe(listener: (trace: Trace) => void): () => void;
  totalCost: DevtoolsAiTotalCost;
  /** `true` when `@warlock.js/ai` observes nothing (read per call). */
  observationOff(): boolean;
};
