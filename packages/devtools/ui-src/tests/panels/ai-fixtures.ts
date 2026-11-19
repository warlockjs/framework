import type {
  DevtoolsAiReportView,
  DevtoolsAiModelsView,
  DevtoolsAiErrorsView,
  DevtoolsAiTotals,
  DevtoolsAiSeriesSet,
} from "@contracts";

const HOUR = 3_600_000;
export const FROM = Date.UTC(2026, 10, 12, 0, 0, 0);

export function totals(overrides: Partial<DevtoolsAiTotals> = {}): DevtoolsAiTotals {
  return {
    runs: 100,
    completed: 90,
    failed: 8,
    incomplete: 2,
    cancelled: 1,
    errorRate: 0.1,
    tokens: { input: 120_000, output: 30_000, cached: 40_000, cacheWrite: 0, reasoning: 0 },
    cost: { estimatedUsd: 12.5, pricedRuns: 90, unpricedRuns: 10, unpricedTokens: 5000 },
    latency: { p50Ms: 1000, p95Ms: 7500, meanMs: 2000 },
    fallbackRuns: 5,
    refusals: 3,
    ...overrides,
  };
}

export const buckets = [0, 1, 2, 3].map((index) => FROM + index * 6 * HOUR);

export function seriesSet(): DevtoolsAiSeriesSet {
  return {
    buckets,
    series: [
      { key: "openai/gpt-4o", label: "openai/gpt-4o", values: [1, 2, 0, 3], other: false },
      { key: "anthropic/claude", label: "anthropic/claude", values: [2, 0, 0, 1], other: false },
      { key: "other", label: "Other", values: [0, 1, 0, 1], other: true },
    ],
  };
}

export const range = {
  preset: "7d" as const,
  from: FROM,
  to: FROM + 28 * 6 * HOUR,
  stepMs: 6 * HOUR,
  utcOffsetMinutes: 0,
};

export const filters = {
  agents: ["checkout", "support"],
  models: ["openai/gpt-4o", "anthropic/claude"],
  providers: ["openai", "anthropic"],
};

export function reportView(
  overrides: Partial<Extract<DevtoolsAiReportView, { available: true }>> = {},
): DevtoolsAiReportView {
  return {
    available: true,
    range,
    previousRange: { from: FROM - 7 * 24 * HOUR, to: FROM },
    previousComplete: true,
    totals: totals(),
    previous: totals({
      runs: 80,
      errorRate: 0.05,
      cost: { estimatedUsd: 10, pricedRuns: 70, unpricedRuns: 10, unpricedTokens: 0 },
    }),
    costByModel: seriesSet(),
    tokens: {
      buckets,
      series: [
        { key: "uncached", label: "Uncached input", values: [10, 20, 0, 30], other: false },
        { key: "cached", label: "Cached input", values: [5, 5, 0, 5], other: false },
        { key: "output", label: "Output", values: [3, 3, 0, 3], other: false },
      ],
    },
    errorRate: [
      { at: buckets[0] ?? 0, runs: 10, errors: 1, rate: 0.1 },
      { at: buckets[1] ?? 0, runs: 0, errors: 0, rate: null },
      { at: buckets[2] ?? 0, runs: 10, errors: 2, rate: 0.2 },
      { at: buckets[3] ?? 0, runs: 10, errors: 3, rate: 0.3 },
    ],
    topAgents: [
      { key: "checkout", label: "checkout", provider: null, totals: totals(), share: 0.6 },
    ],
    topModels: [
      {
        key: "openai/gpt-4o",
        label: "openai/gpt-4o",
        provider: "openai",
        totals: totals(),
        share: 0.7,
      },
    ],
    unpricedModels: [],
    filters,
    observationOff: false,
    generatedAt: FROM,
    ...overrides,
  } as DevtoolsAiReportView;
}

export function modelsView(): DevtoolsAiModelsView {
  const row = (key: string, pricing: "set" | "missing" | "partial") => ({
    key,
    model: key.split("/")[1] ?? key,
    provider: key.split("/")[0] ?? "",
    totals: totals(),
    pricing,
    costPerRunUsd: pricing === "missing" ? null : 0.14,
    fallbackRate: 0.05,
    agents: ["checkout"],
    lastSeenAt: FROM,
  });

  return {
    available: true,
    range,
    totals: totals(),
    models: [
      row("openai/gpt-4o", "set"),
      row("local/tiny", "missing"),
      row("anthropic/claude", "partial"),
    ],
    runsByModel: seriesSet(),
    filters,
    observationOff: false,
    generatedAt: FROM,
  };
}

export function errorsView(
  recent: Extract<DevtoolsAiErrorsView, { available: true }>["recent"] = [],
): DevtoolsAiErrorsView {
  return {
    available: true,
    range,
    totals: totals(),
    previous: totals({ failed: 4, incomplete: 1, errorRate: 0.05 }),
    previousComplete: true,
    groups: [
      {
        category: "rate-limit",
        label: "Rate limit",
        count: 6,
        share: 0.6,
        previousCount: 3,
        byModel: [{ key: "openai/gpt-4o", count: 6 }],
        byAgent: [{ key: "checkout", count: 4 }],
      },
      {
        category: "timeout",
        label: "Timeout",
        count: 4,
        share: 0.4,
        previousCount: 0,
        byModel: [],
        byAgent: [],
      },
    ],
    overTime: {
      buckets,
      series: [
        { key: "rate-limit", label: "Rate limit", values: [1, 2, 0, 3], other: false },
        { key: "timeout", label: "Timeout", values: [0, 1, 0, 3], other: false },
      ],
    },
    recent,
    filters,
    observationOff: false,
    generatedAt: FROM,
  };
}

export const unavailable = (
  reason: string,
  title: string,
  message: string,
  command: string | null = null,
) => ({
  available: false,
  reason,
  title,
  message,
  command,
  detail: null,
});
