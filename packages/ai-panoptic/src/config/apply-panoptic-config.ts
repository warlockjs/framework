import type { ExecutionReport, Observer } from "@warlock.js/ai";
import { registerObserver, setObserveAll } from "@warlock.js/ai";
import { log } from "@warlock.js/logger";
import type { ExporterContract } from "../contracts/exporter.contract";
import { dashboard } from "../dashboard/dashboard";
import type { DashboardHandle, DashboardOptions } from "../dashboard/dashboard.type";
import { panoptic } from "../panoptic/panoptic";
import type { Panoptic } from "../panoptic/panoptic.type";
import { createCacheTraceStore } from "../store/cache-trace-store";
import type { CacheTraceStoreHandle } from "../store/cache-trace-store";
import { createInMemoryTraceStore } from "../store/in-memory-trace-store";
import type { TraceStoreContract } from "../store/trace-store.contract";
import type { PanopticConfig } from "./panoptic-config.type";

/**
 * Module-level applied state. Applying panoptic config is idempotent:
 * the collector is registered as a core `Observer` exactly once, the
 * dashboard is started at most once, and repeat calls only refresh the
 * `observeAll` flag (the latest config wins) without double-registering.
 */
type AppliedState = {
  /** The single collector registered as a core `Observer`. */
  panopticInstance: Panoptic;
  /** The dashboard handle, once started. Started at most once. */
  dashboardHandle?: DashboardHandle;
};

let applied: AppliedState | undefined;

/**
 * Read a {@link PanopticConfig} and wire panoptic onto the core observe
 * seam — the bridge `ai.config({ panoptic })` resolves through. Builds a
 * collector via the EXISTING {@link panoptic} factory (reusing its
 * collection pipeline, not reinventing it), registers it once via core's
 * `registerObserver` (the subscriber's `collect(report)` structurally IS
 * an {@link Observer}, threaded through a thin wrapper), sets
 * `observeAll`, and — when `config.dashboard` is set — starts the
 * dashboard over the config's store (a store-shaped exporter, or a fresh
 * in-memory store panoptic registers when none was supplied).
 *
 * **Idempotent.** Safe to call on every `onConfigApplied` notification:
 * the observer is registered once, the dashboard started once. Repeat
 * calls update `observeAll` to the latest value but never double-register
 * or double-start. `undefined` config is a no-op (nothing wired).
 *
 * @returns the resolved store-shaped exporter when the dashboard needs
 * one and a fresh store was created — primarily for tests; callers can
 * ignore it.
 */
export function applyPanopticConfig(config?: PanopticConfig): void {
  if (config === undefined) {
    return;
  }

  // observeAll always tracks the latest config, even on a repeat call.
  setObserveAll(Boolean(config.observeAll));

  if (applied === undefined) {
    const exporters = [...(config.exporters ?? [])];
    let store = findStore(exporters);

    // Track a cache store separately so we can await its hydration before
    // the dashboard reads it — the in-memory store needs no warm-up.
    let cacheStore: CacheTraceStoreHandle | undefined;

    // The dashboard needs a queryable store. If none was supplied via
    // exporters but a dashboard is requested, create one and register it
    // as an exporter so the collector fills it. A configured `cache` picks
    // the durable cache-backed store; otherwise fall back to in-memory so
    // the dashboard works with no cache configured.
    if (store === undefined && config.dashboard) {
      if (config.cache !== undefined) {
        const onError =
          config.onError ?? ((error: unknown) => log.error("ai-panoptic", "cacheStore", error));

        cacheStore = createCacheTraceStore(config.cache, { onError });
        store = cacheStore;
      } else {
        store = createInMemoryTraceStore();
      }

      exporters.push(store as unknown as ExporterContract);
    }

    const panopticInstance = panoptic({
      exporters,
      captureContent: config.captureContent,
      fullHistory: config.fullHistory,
    });
    registerObserver(toObserver(panopticInstance));

    applied = { panopticInstance };

    if (config.dashboard && store !== undefined) {
      const resolvedStore = store;

      // Hydrate the cache mirror (if any) before serving, so a restart
      // surfaces previously-persisted traces immediately. A bare in-memory
      // store resolves the readyGate instantly.
      const readyGate = cacheStore !== undefined ? cacheStore.ready() : Promise.resolve();

      void readyGate
        .catch(() => {
          // Hydration is best-effort — never block the dashboard on it.
        })
        .then(() => startDashboard(resolvedStore, config.dashboard ?? {}))
        .then((handle) => {
          if (applied !== undefined) {
            applied.dashboardHandle = handle;
          }
        });
    }
  }
}

/**
 * Reset the applied state — internal, test-only. Closes any running
 * dashboard and forgets the registered collector so a fresh
 * `applyPanopticConfig` starts clean. NOT part of the public surface and
 * does NOT unregister from the core observer registry (use core's
 * `clearObservers` for that in tests).
 */
export async function resetAppliedPanopticConfig(): Promise<void> {
  const handle = applied?.dashboardHandle;
  applied = undefined;

  if (handle !== undefined) {
    await handle.close();
  }
}

/**
 * The currently-running dashboard handle, or `undefined` when no
 * dashboard is active. Internal, test-only — lets a spec await the
 * asynchronously-started dashboard. NOT part of the public surface.
 */
export function getActiveDashboardHandle(): DashboardHandle | undefined {
  return applied?.dashboardHandle;
}

/**
 * Wrap a {@link Panoptic} subscriber as a core {@link Observer}. The
 * subscriber already exposes `collect(report)` with a matching signature,
 * but the thin wrapper makes the structural adaptation explicit and keeps
 * the registered object a minimal `Observer` rather than the whole
 * subscriber surface.
 */
function toObserver(instance: Panoptic): Observer {
  return {
    collect(report: ExecutionReport): Promise<void> {
      return instance.collect(report);
    },
  };
}

/**
 * Find the first exporter that satisfies the {@link TraceStoreContract}
 * read surface (`query` / `get` / `aggregate`) — the in-memory store
 * doubles as an exporter, so a store passed via `exporters` is reused for
 * the dashboard rather than creating a second one.
 */
function findStore(exporters: ExporterContract[]): TraceStoreContract | undefined {
  for (const exporter of exporters) {
    const candidate = exporter as unknown as Partial<TraceStoreContract>;

    if (
      typeof candidate.query === "function" &&
      typeof candidate.get === "function" &&
      typeof candidate.aggregate === "function"
    ) {
      return candidate as TraceStoreContract;
    }
  }

  return undefined;
}

/** Start the dashboard, normalizing the `true | DashboardOptions` switch. */
function startDashboard(
  store: TraceStoreContract,
  dashboardConfig: boolean | DashboardOptions,
): Promise<DashboardHandle> {
  const options: DashboardOptions = typeof dashboardConfig === "object" ? dashboardConfig : {};

  return dashboard(store, options);
}
