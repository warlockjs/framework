import {
  DEVTOOLS_AI_ERROR_CATEGORIES,
  DEVTOOLS_AI_LATENCY_BUCKETS_MS,
} from "../../production/contracts";
import type { DevtoolsAiRollupDelta, DevtoolsAiRollupRecord } from "../types";
import { emptyRollupDelta } from "./extract";

/** A row of `devtools_ai_rollups`: snake_case columns, `err_*` and `lat_<n>` columns spelled out. */
export type DevtoolsAiRollupRow = Record<string, unknown>;

/** The numeric counters and their column names (errors and latency are mapped separately). */
const COUNTER_COLUMNS = [
  ["runs", "runs"],
  ["completed", "completed"],
  ["failed", "failed"],
  ["incomplete", "incomplete"],
  ["cancelled", "cancelled"],
  ["inputTokens", "input_tokens"],
  ["outputTokens", "output_tokens"],
  ["cachedTokens", "cached_tokens"],
  ["cacheWriteTokens", "cache_write_tokens"],
  ["reasoningTokens", "reasoning_tokens"],
  ["costUsd", "cost_usd"],
  ["pricedRuns", "priced_runs"],
  ["unpricedRuns", "unpriced_runs"],
  ["unpricedTokens", "unpriced_tokens"],
  ["fallbackRuns", "fallback_runs"],
  ["refusals", "refusals"],
  ["latencyCount", "latency_count"],
  ["latencySumMs", "latency_sum_ms"],
] as const;

const BUCKET_COUNT = DEVTOOLS_AI_LATENCY_BUCKETS_MS.length + 1;

/** The column of an error category: `err_` plus the category with dashes as underscores. */
function errorColumn(category: string): string {
  return `err_${category.replaceAll("-", "_")}`;
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

/** Every counter column with its amount; counters at 0 are left out. */
function allCounters(delta: DevtoolsAiRollupDelta): Record<string, number> {
  const columns: Record<string, number> = {};

  for (const [field, column] of COUNTER_COLUMNS) columns[column] = delta[field];

  for (const category of DEVTOOLS_AI_ERROR_CATEGORIES) {
    columns[errorColumn(category)] = delta.errors[category] ?? 0;
  }

  for (let index = 0; index < BUCKET_COUNT; index++) {
    columns[`lat_${index}`] = delta.latency[index] ?? 0;
  }

  return columns;
}

/** The `$inc` part of a delta: every counter column with its amount (zero counters left out). */
export function deltaToIncrements(delta: DevtoolsAiRollupDelta): Record<string, number> {
  const increments: Record<string, number> = {};

  for (const [column, amount] of Object.entries(allCounters(delta))) {
    if (amount !== 0) increments[column] = amount;
  }

  return increments;
}

/** A full row for a record (inserts and the memory/file stores' round-trip specs). */
export function recordToRow(record: DevtoolsAiRollupRecord): DevtoolsAiRollupRow {
  return {
    id: record.id,
    hour: record.hour,
    agent: record.agent,
    model: record.model,
    provider: record.provider,
    ...allCounters(record),
    updated_at: record.updatedAt,
  };
}

/** A record from a row; numbers a driver returns as strings are converted. */
export function rowToRecord(row: DevtoolsAiRollupRow): DevtoolsAiRollupRecord {
  const record: DevtoolsAiRollupRecord = {
    ...emptyRollupDelta({
      hour: number(row.hour),
      agent: String(row.agent ?? ""),
      model: String(row.model ?? ""),
      provider: String(row.provider ?? ""),
    }),
    id: String(row.id ?? ""),
    updatedAt: number(row.updated_at),
  };

  for (const [field, column] of COUNTER_COLUMNS) record[field] = number(row[column]);

  for (const category of DEVTOOLS_AI_ERROR_CATEGORIES) {
    record.errors[category] = number(row[errorColumn(category)]);
  }

  for (let index = 0; index < BUCKET_COUNT; index++) {
    record.latency[index] = number(row[`lat_${index}`]);
  }

  return record;
}
