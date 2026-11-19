import { describe, expect, it, vi } from "vitest";
import { createAiReportService } from "../../../src/ai/reports/service";
import { createMemoryAiRollupStore } from "../../../src/ai/rollup";
import { H, row } from "./fixtures";

const now = Date.UTC(2026, 2, 10, 10, 30);
const hour = Math.floor(now / H) * H;

async function setup(pending: ReturnType<typeof row>[] = [], extra: Record<string, unknown> = {}) {
  const store = createMemoryAiRollupStore();

  await store.increment([
    row(
      { hour: hour - H },
      {
        runs: 4,
        completed: 3,
        failed: 1,
        costUsd: 2,
        pricedRuns: 4,
        errors: { provider: 1 } as never,
      },
    ),
    row(
      { hour: hour - H, agent: "other", model: "claude", provider: "anthropic" },
      { runs: 2, completed: 2, unpricedRuns: 2, unpricedTokens: 10 },
    ),
    row({ hour: hour - 30 * H }, { runs: 7, completed: 7 }),
  ]);

  const list = vi.spyOn(store, "list");
  const service = createAiReportService({
    store,
    pending: () => pending,
    retentionDays: 30,
    observationOff: () => false,
    now: () => now,
    ...extra,
  });

  return { service, list };
}

describe("createAiReportService", () => {
  it("builds the report with previous period and unpriced models", async () => {
    const { service } = await setup();
    const view = await service.report({});

    if (!view.available) throw new Error("unavailable");

    expect(view.totals.runs).toBe(6);
    expect(view.previous.runs).toBe(7);
    expect(view.unpricedModels).toEqual(["anthropic/claude"]);
    expect(view.filters.agents).toEqual(["other", "support"]);
    expect(view.topModels[0]?.key).toBe("openai/gpt-4o");
    expect(view.observationOff).toBe(false);
  });

  it("adds pending deltas so a run shows at once", async () => {
    const { service } = await setup([row({ hour }, { runs: 1, completed: 1 })]);
    const view = await service.report({});

    expect(view.available && view.totals.runs).toBe(7);
  });

  it("filters rows but keeps every filter option", async () => {
    const { service } = await setup();
    const view = await service.report({ agent: "support", model: "openai/gpt-4o" });

    if (!view.available) throw new Error("unavailable");

    expect(view.totals.runs).toBe(4);
    expect(view.filters.agents).toEqual(["other", "support"]);
  });

  it("answers models and errors", async () => {
    const { service } = await setup();
    const models = await service.models({});
    const errors = await service.errors({});

    expect(models.available && models.models.map((m) => m.key)).toEqual([
      "openai/gpt-4o",
      "anthropic/claude",
    ]);
    expect(errors.available && errors.groups[0]?.category).toBe("provider");
    expect(errors.available && errors.recent).toBeNull();
  });

  it("reads recent failures fresh, outside the cache", async () => {
    let failures: never[] = [];
    const { service } = await setup([], { recentFailures: () => failures });

    expect((await service.errors({})).available && (await service.errors({})).recent).toEqual([]);
    failures = [{ traceId: "t" } as never];
    const again = await service.errors({});
    expect(again.available && again.recent).toHaveLength(1);
  });

  it("scopes recent failures to the page's range and filters", async () => {
    const seen: unknown[] = [];
    const { service } = await setup([], {
      recentFailures: (filter: unknown) => {
        seen.push(filter);

        return [];
      },
    });

    const view = await service.errors({ range: "7d", agent: "support", model: "openai/gpt-4o" });

    expect(view.available && view.range).toBeTruthy();
    expect(seen[0]).toEqual({
      from: view.available ? view.range.from : 0,
      to: view.available ? view.range.to : 0,
      agent: "support",
      model: { provider: "openai", model: "gpt-4o" },
    });
  });

  it("says when the previous period reaches past the kept history", async () => {
    const { service } = await setup();

    const day = await service.report({ range: "24h" });
    const month = await service.report({ range: "30d" });

    expect(day.available && day.previousComplete).toBe(true);
    // 30 days back from the 30-day range is older than the 30 days kept.
    expect(month.available && month.previousComplete).toBe(false);
  });

  it("caches per query for 15 seconds", async () => {
    let at = now;
    const { service, list } = await setup([], { now: () => at });

    await service.report({});
    await service.report({});
    expect(list).toHaveBeenCalledTimes(1);

    await service.report({ agent: "support" });
    expect(list).toHaveBeenCalledTimes(2);

    at += 16_000;
    await service.report({});
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("throws ai.range-invalid for a bad query", async () => {
    const { service } = await setup();

    await expect(service.report({ range: "nope" })).rejects.toMatchObject({
      code: "ai.range-invalid",
    });
  });
});
