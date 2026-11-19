import type { Trace } from "@warlock.js/ai-panoptic";

type Span = Trace["root"];
type Usage = Span["usage"];

export const HOUR = 3_600_000;
export const T0 = Date.parse("2026-06-22T10:15:00.000Z");
export const HOUR_START = Math.floor(T0 / HOUR) * HOUR;

/** A span with sensible defaults; override anything. */
export function span(name: string, overrides: Partial<Span> = {}): Span {
  return {
    spanId: `${name}-id`,
    traceId: "t1",
    name,
    type: "agent",
    status: "completed",
    startedAt: new Date(T0 - 1000).toISOString(),
    endedAt: new Date(T0).toISOString(),
    duration: 1000,
    usage: { input: 0, output: 0, total: 0 },
    children: [],
    ...overrides,
  } as Span;
}

/** An agent span carrying model identity. */
export function agentSpan(
  name: string,
  model: string,
  provider: string,
  overrides: Partial<Span> = {},
): Span {
  return span(name, {
    attributes: { "agent.model.name": model, "agent.model.provider": provider },
    ...overrides,
  });
}

export function usage(input: number, output: number, extra: Partial<Usage> = {}): Usage {
  return { input, output, total: input + output, ...extra };
}

export function traceOf(root: Span): Trace {
  return {
    traceId: root.traceId,
    root,
    startedAt: root.startedAt,
    endedAt: root.endedAt,
    duration: root.duration,
    usage: root.usage,
  };
}

/** Price: $1 per 1000 input tokens plus $2 per 1000 output tokens; undefined without tokens. */
export function priceOf(u: Usage | undefined): number | undefined {
  if (!u) return undefined;

  return (u.input * 1 + u.output * 2) / 1000;
}

/** A pricing function that knows nothing. */
export const noPrice = () => undefined;
