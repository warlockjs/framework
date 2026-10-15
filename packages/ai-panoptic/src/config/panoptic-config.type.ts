import type { ExporterContract } from "../contracts/exporter.contract";
import type { DashboardOptions } from "../dashboard/dashboard.type";
import type { CacheDriverInput } from "../store/cache-trace-store";

/**
 * Declarative panoptic configuration, set once through the global
 * `ai.config({ panoptic: { … } })`. Sugar layered over the existing
 * {@link import("../panoptic/panoptic").panoptic} factory: reading this
 * slot (on the side-effect import of `@warlock.js/ai-panoptic`) builds
 * the same collector, registers it as a core `Observer`, and optionally
 * starts the local dashboard — so app code never hand-wires a store and
 * a server. The explicit `panoptic({ exporters })` / `.attach()` /
 * `.collect()` API stays fully intact as the underlying primitive.
 *
 * @example
 * import { ai } from "@warlock.js/ai";
 * import "@warlock.js/ai-panoptic"; // side-effect wiring
 *
 * ai.config({
 *   panoptic: {
 *     exporters: [createInMemoryTraceStore({ capacity: 5000 })],
 *     dashboard: { port: 4319, open: true },
 *     observeAll: true,
 *   },
 * });
 */
export type PanopticConfig = {
  /**
   * Exporters the collector feeds (a store, OTel, Langfuse, …). A
   * {@link import("../store/in-memory-trace-store").createInMemoryTraceStore}
   * store doubles as an `ExporterContract`, so passing one here both
   * captures traces and gives the dashboard something to read.
   */
  exporters?: ExporterContract[];
  /**
   * Persist traces through a {@link import("@warlock.js/cache").CacheDriver}
   * (Redis, Postgres, file, …) so they survive a process restart. Accepts a
   * driver instance or a (possibly async) factory resolved lazily on first
   * use — the factory form lets production defer the connect.
   *
   * When set (and no store-shaped exporter was supplied), the dashboard
   * reads a {@link import("../store/cache-trace-store").createCacheTraceStore}
   * store instead of a fresh in-memory one. When omitted, panoptic falls
   * back to {@link import("../store/in-memory-trace-store").createInMemoryTraceStore}
   * — so the dashboard works with no cache configured.
   */
  cache?: CacheDriverInput;
  /**
   * Serve the local dashboard. `true` uses the defaults
   * ({@link DashboardOptions}); an object overrides them. When set, the
   * dashboard reads the store supplied via `exporters` (the first
   * store-shaped exporter), or a fresh in-memory store panoptic creates
   * and registers when none was supplied.
   */
  dashboard?: boolean | DashboardOptions;
  /**
   * Observe every flow (`ai.agent` / `ai.workflow` / `ai.supervisor` /
   * `ai.team`) by default. Individual flows opt out with `observe: false`.
   * Default `false` — opt-in observability.
   */
  observeAll?: boolean;
  /**
   * Capture raw prompt / response / tool I/O onto each span so the dashboard
   * + console exporter can surface them. Off by default (payloads are large
   * and can be sensitive); set `true` for a content-rich local dashboard.
   */
  captureContent?: boolean;
  /**
   * Emit each agent's full message history (every trip, every role) onto
   * `span.input` instead of just `[system, user]`. Requires the agent run to
   * set `captureMessages`. Default `false`.
   */
  fullHistory?: boolean;
  /**
   * Called whenever the cache-backed store (see {@link cache}) fails a
   * hydrate-on-startup or write-through — a bad URL, an unreachable Redis, an
   * auth failure. The store is best-effort by design (a flaky cache must
   * never throw into the collector's hot path), so without this hook a
   * failure is otherwise invisible: the dashboard just silently shows no
   * traces, forever, with no diagnostic anywhere. When omitted, defaults to
   * `log.error("ai-panoptic", "cacheStore", error)` so it's never silent
   * out of the box; pass your own (even a no-op) to override.
   */
  onError?: (error: unknown) => void;
};

// Panoptic AUGMENTS the core config type via declaration merging — core
// never imports panoptic. `ai.config(...)` (`setAIConfig`) stores this
// opaque slot without understanding it; `applyPanopticConfig` reads it on
// the side-effect import.
declare module "@warlock.js/ai" {
  interface AIConfig {
    /** Declarative panoptic observability config. See {@link PanopticConfig}. */
    panoptic?: PanopticConfig;
  }
}
