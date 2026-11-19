import { describe, expect, it } from "vitest";
import { DEVTOOLS_AI_ERROR_CATEGORIES } from "../../../src/production/contracts";
import { emptyRollupDelta, rollupId } from "../../../src/ai/rollup/extract";
import { deltaToIncrements, recordToRow, rowToRecord } from "../../../src/ai/rollup/mapping";
import { HOUR_START } from "./helpers";

function sample() {
  const key = { hour: HOUR_START, agent: "a", model: "m", provider: "p" };
  const delta = emptyRollupDelta(key);

  delta.runs = 3;
  delta.inputTokens = 1200;
  delta.costUsd = 0.25;
  delta.errors["rate-limit"] = 2;
  delta.latency[3] = 3;
  delta.latencyCount = 3;
  delta.latencySumMs = 5400;

  return { ...delta, id: rollupId(key), updatedAt: 99 };
}

describe("ai rollup row mapping", () => {
  it("maps counters to snake_case columns and leaves zeros out of the increments", () => {
    expect(deltaToIncrements(sample())).toEqual({
      runs: 3,
      input_tokens: 1200,
      cost_usd: 0.25,
      err_rate_limit: 2,
      lat_3: 3,
      latency_count: 3,
      latency_sum_ms: 5400,
    });
  });

  it("spells out every category and bucket column in a full row", () => {
    const row = recordToRow(sample());

    for (const category of DEVTOOLS_AI_ERROR_CATEGORIES) {
      expect(row).toHaveProperty(`err_${category.replaceAll("-", "_")}`);
    }

    for (let index = 0; index < 16; index++) expect(row).toHaveProperty(`lat_${index}`);

    expect(row).toMatchObject({
      id: sample().id,
      hour: HOUR_START,
      updated_at: 99,
      err_rate_limit: 2,
    });
  });

  it("round-trips a record", () => {
    expect(rowToRecord(recordToRow(sample()))).toEqual(sample());
  });

  it("converts the strings a PostgreSQL driver returns for bigint and double columns", () => {
    const row = {
      ...recordToRow(sample()),
      hour: String(HOUR_START),
      input_tokens: "1200",
      cost_usd: "0.25",
      updated_at: "99",
    };

    expect(rowToRecord(row)).toEqual(sample());
  });
});
