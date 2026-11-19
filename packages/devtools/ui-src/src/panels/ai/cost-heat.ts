import type { AiSpanNode } from "./types";

/** Adds up every number in a cost value: a plain number, or an object of USD amounts per channel. */
function sumCost(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    return Object.values(value).reduce<number>((sum, item) => sum + sumCost(item), 0);
  }

  return 0;
}

/**
 * The estimated USD cost of one span itself, children not included; `null`
 * when it has none. A span's `usage` is rolled up (its own cost plus every
 * child's), so the children's rolled-up cost is subtracted, clamped at 0.
 */
export function spanCostUsd(span: AiSpanNode): number | null {
  const children = span.children.reduce((sum, child) => sum + sumCost(child.usage?.cost), 0);
  const cost = Math.max(0, sumCost(span.usage?.cost) - children);

  return cost > 0 ? cost : null;
}

/** The highest span cost in a tree, for scaling the tint. */
export function maxSpanCost(span: AiSpanNode): number {
  return Math.max(spanCostUsd(span) ?? 0, ...span.children.map(maxSpanCost));
}

/** The background of a span row: the brand colour at 5 to 25 percent, by its share of the costliest span. */
export function heatBackground(cost: number | null, max: number): string | undefined {
  if (cost === null || max <= 0) return undefined;

  const percent = 5 + 20 * Math.min(1, cost / max);

  return `color-mix(in srgb, var(--brand) ${percent.toFixed(1)}%, transparent)`;
}
