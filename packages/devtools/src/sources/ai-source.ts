import type { Trace, TraceSpan, TraceStoreContract } from "@warlock.js/ai-panoptic";
import { installedVersion } from "../app-versions";
import type { DevtoolsAiRunHelpers } from "../ai/reports/runs";
import { spanModelOf } from "../ai/rollup/extract";
import type { DevtoolsAiTotalCost } from "../ai/types";
import type { DevtoolsAiUnavailableView } from "../production/contracts";
import { toSafeValue } from "../safe-value";
import type { DevtoolsDisposer } from "../types";

export type DevtoolsAiUnavailableReason =
  | "ai-missing"
  | "panoptic-missing"
  | "panoptic-failed"
  | "observation-off"
  | "not-collected"
  | "table-missing"
  | "reports-off";

/** Why the AI tab is empty, as sent to the dashboard: a title, one line and an optional command. */
export type DevtoolsAiUnavailable = {
  available: false;
  reason: DevtoolsAiUnavailableReason;
  title: string;
  message: string;
  command?: string;
  detail?: string;
};

/** Replaces absolute file paths in an error line with their package-relative part, or `<path>`. */
export function redactPaths(text: string): string {
  return text.replace(/(?:file:\/\/)?(?:[A-Za-z]:)?[\\/][^\s'"`()]*/g, (match) => {
    const normalized = match.replace(/^file:\/\//, "").replaceAll("\\", "/");
    const index = normalized.lastIndexOf("node_modules/");

    return index === -1 ? "<path>" : normalized.slice(index + "node_modules/".length);
  });
}

const OBSERVATION_COMMAND = "ai.config({ panoptic: { observeAll: true } })";

/** The answer for each reason; `detail` carries the load error and versions for `panoptic-failed`. */
export function describeAiUnavailable(
  reason: DevtoolsAiUnavailableReason,
  detail?: string,
): DevtoolsAiUnavailable {
  switch (reason) {
    case "ai-missing":
      return {
        available: false,
        reason,
        title: "AI isn't installed",
        message: "Add @warlock.js/ai to see AI runs here.",
        command: "warlock add ai",
      };
    case "panoptic-missing":
      return {
        available: false,
        reason,
        title: "Panoptic isn't installed",
        message: "Your app uses @warlock.js/ai. Add Panoptic to see its runs.",
        command: "warlock add ai-panoptic",
      };
    case "panoptic-failed":
      return {
        available: false,
        reason,
        title: "Panoptic could not be loaded",
        message:
          "Panoptic is installed but failed to load. Check that both packages share a version.",
        detail,
      };
    case "not-collected":
      return {
        available: false,
        reason,
        title: "AI runs are not collected here",
        message:
          "Production keeps hourly AI totals, not run details. Open Reports, Models or Errors here, or the Runs tab in development (warlock dev).",
      };
    case "table-missing":
      return {
        available: false,
        reason,
        title: "AI reports need their table",
        message: "Run the devtools migrations to create devtools_ai_rollups, then restart the app.",
        command: "warlock migrate",
      };
    case "reports-off":
      return {
        available: false,
        reason,
        title: "AI reports are off",
        message:
          "Set devtools.ai.reports to true in src/config/devtools.ts to keep hourly AI totals.",
      };
    case "observation-off":
      return {
        available: false,
        reason,
        title: "AI observation is off",
        message: "Turn it on in src/config/ai.ts, then restart warlock dev.",
        command: OBSERVATION_COMMAND,
      };
  }
}

/** The unavailable answer as the AI routes send it: `command` and `detail` are `null` when absent. */
export function toAiUnavailableView(unavailable: DevtoolsAiUnavailable): DevtoolsAiUnavailableView {
  return {
    available: false,
    reason: unavailable.reason,
    title: unavailable.title,
    message: unavailable.message,
    command: unavailable.command ?? null,
    detail: unavailable.detail ?? null,
  };
}

/** Test seam: how packages are loaded and their versions read. */
export type AiSourceDeps = {
  load?: (name: string) => Promise<unknown>;
  version?: (name: string) => string | null;
};

export type DevtoolsAiEvent = { traceId: string; requestId?: string };

/** Only the connector's development branch constructs this source. */
export type DevtoolsAiSource =
  | (DevtoolsAiUnavailable & { dispose: DevtoolsDisposer })
  | {
      available: true;
      /** True when `@warlock.js/ai` has no `observeAll` and no registered observer (read per request). */
      observationOff?: () => boolean;
      /** Totals a trace's priced usage (Panoptic's `totalCostUsd`). */
      totalCost: DevtoolsAiTotalCost;
      /** Panoptic's trace filter, grouping and percentile helpers for the Runs list. */
      helpers: DevtoolsAiRunHelpers;
      store: TraceStoreContract;
      summarize: (trace: Trace) => DevtoolsAiRun;
      subscribe: (listener: (event: DevtoolsAiEvent) => void) => DevtoolsDisposer;
      dispose: DevtoolsDisposer;
    };

export type DevtoolsAiRun = {
  traceId: string;
  requestId?: string;
  sessionId?: string;
  name: string;
  status: TraceSpan["status"];
  startedAt: string;
  duration: number;
  usage: Trace["usage"];
  cost?: number;
  models: string[];
  toolCalls: number;
  retries: number;
  cacheHits?: number;
  incomplete: boolean;
  truncatedTrips: number;
  compactions: number;
  skippedCompactions: number;
  providerCompactions: number;
};

/** Summaries use root usage once: nested spans already roll up into it. */
export function summarizeAiTrace(trace: Trace, cost?: number): DevtoolsAiRun {
  const models = new Set<string>();
  let toolCalls = 0;
  let retries = 0;
  let cacheHits: number | undefined;
  let incomplete = false;
  let truncatedTrips = 0;
  let compactions = 0;
  let skippedCompactions = 0;
  let providerCompactions = 0;
  const visit = (span: TraceSpan): void => {
    const attributes = span.attributes ?? {};
    const { name: model, provider } = spanModelOf(span);
    if (model !== undefined) models.add(provider !== undefined ? `${provider}/${model}` : model);
    if (span.type === "tool") toolCalls += 1;
    if (typeof attributes.retries === "number") retries += attributes.retries;
    if (typeof attributes["agent.cacheHits"] === "number")
      cacheHits = (cacheHits ?? 0) + attributes["agent.cacheHits"];
    if (typeof attributes["agent.truncatedTrips"] === "number")
      truncatedTrips += attributes["agent.truncatedTrips"];
    if (typeof attributes["agent.providerCompactions"] === "number")
      providerCompactions += attributes["agent.providerCompactions"];
    if (Array.isArray(attributes["agent.compactions"])) {
      const records: unknown[] = attributes["agent.compactions"];
      for (const record of records) {
        if (typeof record !== "object" || record === null || !("type" in record)) continue;
        if (record.type === "applied") compactions += 1;
        if (record.type === "skipped") skippedCompactions += 1;
      }
    }
    incomplete ||=
      span.status === "incomplete" ||
      span.error?.type === "AgentIncompleteError" ||
      span.error?.type === "AGENT_INCOMPLETE";
    span.children.forEach(visit);
  };
  visit(trace.root);
  return {
    traceId: trace.traceId,
    requestId: trace.requestId,
    sessionId: trace.sessionId,
    name: trace.root.name,
    status: trace.root.status,
    startedAt: trace.startedAt,
    duration: trace.duration,
    usage: trace.usage,
    cost,
    models: [...models],
    toolCalls,
    retries,
    cacheHits,
    incomplete,
    truncatedTrips,
    compactions,
    skippedCompactions,
    providerCompactions,
  };
}

/** Content-free snapshot; never retain prompts, completions or tool arguments/results. */
function snapshotSpan(span: TraceSpan): TraceSpan {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    traceId: span.traceId,
    sessionId: span.sessionId,
    name: span.name,
    version: span.version,
    type: span.type,
    status: span.status,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    duration: span.duration,
    usage: structuredClone(span.usage),
    error: span.error ? { type: span.error.type, message: span.error.message } : undefined,
    attributes: toSafeValue(span.attributes) as Record<string, unknown> | undefined,
    children: span.children.map(snapshotSpan),
  };
}

type PanopticModule = typeof import("@warlock.js/ai-panoptic");
type AiCoreModule = { isObserveAll?: () => boolean; getObservers?: () => readonly unknown[] };

/**
 * Loads Panoptic (required) and `@warlock.js/ai` (for the observation check)
 * lazily, or says why not. Shared by the development source and the AI
 * reports wiring, so both answer the same unavailable reasons.
 */
export async function loadAiPackages(
  deps: AiSourceDeps = {},
): Promise<
  | { panoptic: PanopticModule; observationOff: () => boolean }
  | { unavailable: DevtoolsAiUnavailable }
> {
  const aiPackage: string = "@warlock.js/ai"; // not a dependency of devtools: never resolved at build time
  const load =
    deps.load ??
    ((name: string) =>
      name === "@warlock.js/ai-panoptic" ? import("@warlock.js/ai-panoptic") : import(aiPackage));
  const version =
    deps.version ?? ((name: string) => installedVersion(name, process.cwd(), import.meta.resolve));
  let panoptic: PanopticModule;
  try {
    panoptic = (await load("@warlock.js/ai-panoptic")) as PanopticModule;
    if (typeof panoptic.subscribeTraces !== "function")
      throw new Error("Trace subscription unavailable");
  } catch (error) {
    const aiVersion = version("@warlock.js/ai");
    const panopticVersion = version("@warlock.js/ai-panoptic");
    if (aiVersion === null) return { unavailable: describeAiUnavailable("ai-missing") };
    if (panopticVersion === null) return { unavailable: describeAiUnavailable("panoptic-missing") };
    const text = redactPaths(
      (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "",
    ).slice(0, 300);
    return {
      unavailable: describeAiUnavailable(
        "panoptic-failed",
        `${text} (@warlock.js/ai ${aiVersion}, @warlock.js/ai-panoptic ${panopticVersion})`,
      ),
    };
  }

  let core: AiCoreModule | undefined;
  try {
    core = (await load("@warlock.js/ai")) as AiCoreModule;
  } catch {
    core = undefined;
  }
  const observationOff = (): boolean =>
    typeof core?.isObserveAll === "function" &&
    typeof core.getObservers === "function" &&
    !core.isObserveAll() &&
    core.getObservers().length === 0;

  return { panoptic, observationOff };
}

/**
 * Optional, lazy integration. Retains only traces collected after devtools boots,
 * using Panoptic's bounded query store; existing exporter/cache stores stay independent.
 */
export async function attachAiSource(
  capacity: number,
  deps: AiSourceDeps = {},
): Promise<DevtoolsAiSource> {
  const loaded = await loadAiPackages(deps);
  if ("unavailable" in loaded) return { ...loaded.unavailable, dispose() {} };
  const { panoptic, observationOff } = loaded;

  const { currentRequestId } = await import("../current-request-id");
  const store = panoptic.createInMemoryTraceStore({ capacity });
  const listeners = new Set<(event: DevtoolsAiEvent) => void>();
  const detach = panoptic.subscribeTraces((trace) => {
    // Read ALS before any asynchronous exporter work, including for runs that
    // finish after the HTTP response. Never use sessionId as a request id.
    const requestId = currentRequestId() ?? trace.requestId;
    store.add({
      ...trace,
      requestId,
      usage: structuredClone(trace.usage),
      root: snapshotSpan(trace.root),
    });
    for (const listener of listeners) {
      try {
        listener({ traceId: trace.traceId, requestId });
      } catch {
        /* isolate clients */
      }
    }
  });

  return {
    available: true,
    observationOff,
    totalCost: (usage) => panoptic.totalCostUsd(usage),
    helpers: {
      filterTraces: panoptic.filterTraces,
      groupBySession: panoptic.groupBySession,
      groupByPrompt: panoptic.groupByPrompt,
      groupByType: panoptic.groupByType,
      percentile: panoptic.percentile,
      tracePromptKey: panoptic.tracePromptKey,
    },
    store,
    summarize: (trace) => summarizeAiTrace(trace, panoptic.totalCostUsd(trace.usage)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      detach();
      listeners.clear();
      store.clear();
    },
  };
}
