/** Managed sitemap runtime lifecycle. HTTP serving only observes this state. */
import type {
  SitemapGenerationManifest,
  SitemapManifestKey,
  SitemapSetResult,
} from "@warlock.js/sitemap";
import { collectSitemapModelDependencies } from "./collect-sitemap-entries";
import { type GenerateSitemapOptions } from "./generate-sitemap";
import { resolveSitemapConfig } from "./resolve-sitemap-config";
import { createSitemapLocalRuntime, type SitemapLocalRuntime } from "./sitemap-local-runtime";
import { createSitemapArtifactStore } from "./sitemap-artifact-store";
import { SitemapRefreshScheduler } from "./sitemap-refresh-scheduler";
import type { SitemapServingState } from "./sitemap-serving-state";
import {
  subscribeSitemapModels,
  type SitemapModelSubscriptions,
} from "./sitemap-model-subscriptions";
import type { SitemapResult } from "./sitemap-result-types";

export type SitemapGenerationResult = SitemapSetResult | SitemapResult;
export type SitemapArtifactFile = { readonly absolutePath: string; readonly gzipped: boolean };
/** @deprecated Manifest storage has replaced local-path artifact serving. */
export type SitemapArtifacts = {
  readonly mainFile: SitemapArtifactFile;
  readonly shardFiles: ReadonlyMap<string, SitemapArtifactFile>;
  readonly result: SitemapGenerationResult;
  readonly generatedAt: number;
};
export type SitemapFailure = { readonly error: unknown; readonly at: number };

let runtime: SitemapLocalRuntime | undefined;
let scheduler: SitemapRefreshScheduler | undefined;
let subscriptions: SitemapModelSubscriptions | undefined;
let servingState: SitemapServingState | undefined;
let lastFailure: SitemapFailure | undefined;
let lifecycleGeneration = 0;

function disabledResult(): SitemapResult {
  return { mode: "disabled", urls: 0, duplicates: [], routes: [] };
}
function reportFailure(error: unknown): void {
  lastFailure = { error, at: Date.now() };
  console.error("[warlock:web] sitemap regeneration failed:", error);
}

/** How often an unknown generation id may trigger a fresh storage listing. */
const UNKNOWN_GENERATION_RELIST_MS = 1_000;

export function createServingState(
  active: Pick<SitemapLocalRuntime, "store" | "currentManifest">,
  cacheControl: string,
  pollMs: number,
  now: () => number = Date.now,
): SitemapServingState {
  let observed = active.currentManifest;
  let lastPoll = 0;
  // Retained generations: their keys from the last storage listing, and the
  // manifests already read (a published manifest never changes).
  let retained: { listedAt: number; keys: Map<string, SitemapManifestKey> } | undefined;
  const manifests = new Map<string, SitemapGenerationManifest>();

  const relist = async (): Promise<Map<string, SitemapManifestKey>> => {
    const keys = new Map<string, SitemapManifestKey>();

    for (const candidate of await active.store.listManifestKeys()) {
      if (!keys.has(candidate.generationId)) keys.set(candidate.generationId, candidate);
    }

    retained = { listedAt: now(), keys };

    for (const generationId of manifests.keys()) {
      if (!keys.has(generationId)) manifests.delete(generationId);
    }

    return keys;
  };

  return {
    store: active.store,
    cacheControl,
    getManifestByGeneration: async (generationId) => {
      let keys =
        retained === undefined || now() - retained.listedAt >= pollMs
          ? await relist()
          : retained.keys;

      // A generation another instance published since the last listing is
      // found within a second; random ids cost at most one listing a second.
      if (
        !keys.has(generationId) &&
        retained !== undefined &&
        now() - retained.listedAt >= UNKNOWN_GENERATION_RELIST_MS
      ) {
        keys = await relist();
      }

      const candidate = keys.get(generationId);

      if (candidate === undefined) return undefined;

      const known = manifests.get(generationId);

      if (known !== undefined) return known;

      const manifest = await active.store.readManifestKey(candidate);

      if (manifest !== undefined) manifests.set(generationId, manifest);

      return manifest;
    },
    getManifest: async () => {
      // A local publication is visible immediately, before the poll throttle.
      const local = active.currentManifest;
      if (local && (!observed || local.fence > observed.fence)) observed = local;
      if (Date.now() - lastPoll < pollMs) return observed;
      lastPoll = Date.now();
      const discovered = await active.store.readLatestManifest();
      if (discovered && (!observed || discovered.fence > observed.fence)) observed = discovered;
      return observed;
    },
  };
}

async function sharedIntervalIsFresh(
  active: SitemapLocalRuntime,
  intervalMs: number | undefined,
): Promise<boolean> {
  if (!intervalMs) return false;
  // This deliberately bypasses normal request poll throttling: an interval tick
  // is a coordination decision, while HTTP still uses the bounded serving poll.
  const manifest = await active.store.readLatestManifest();
  if (!manifest) return false;
  const generatedAt = Date.parse(manifest.generatedAt);
  return Number.isFinite(generatedAt) && Date.now() - generatedAt < intervalMs;
}
/** Start/restore the singleton without making HTTP requests generate anything. */
export async function startSitemapRuntime(options: GenerateSitemapOptions = {}): Promise<void> {
  const config = resolveSitemapConfig();
  if (!config.enabled || runtime) return;

  const store = createSitemapArtifactStore({
    storage: config.storage,
    legacyOutputDir: config.legacyOutputDir,
  });
  if (config.coordination === "shared" && !store.supportsSharedClaims()) {
    const unsupported = new Error(
      "web.sitemap.coordination=shared requires storage with atomic putIfAbsent and consistent listing.",
    );
    reportFailure(unsupported);
    throw unsupported;
  }

  const active = createSitemapLocalRuntime({
    resolvedConfig: config,
    options,
    ports: {
      store,
      ...(config.coordination === "shared"
        ? { allocateFence: (generationId: string) => store.claimFence(generationId) }
        : {}),
    },
  });
  try {
    await active.initialize();
    runtime = active;
    servingState = createServingState(active, config.cacheControl, config.manifestPollMs);

    scheduler = new SitemapRefreshScheduler({
      trigger: async (reason) => {
        if (
          reason === "interval" &&
          config.coordination === "shared" &&
          (await sharedIntervalIsFresh(active, config.regenerateEveryMs))
        )
          return;
        await regenerateSitemap(options);
      },
      intervalMs: config.regenerateEveryMs,
      reportError: reportFailure,
    });
    await refreshSitemapModelSubscriptions(options);
    scheduler.start();
  } catch (error) {
    // Roll back so a later start can retry instead of serving 503 forever.
    if (runtime === active) await shutdownSitemapRuntime();
    else active.dispose();
    reportFailure(error);
    throw error;
  }

  if (!config.regenerate.onBoot) return;
  if (active.currentManifest) {
    void regenerateSitemap(options).catch(reportFailure);
    return;
  }
  await regenerateSitemap(options).catch(reportFailure);
}

/**
 * Refresh page-declared invalidation dependencies after a committed page-route
 * replacement. The old set remains live until discovery and subscription both
 * succeed; a shutdown that races either await disposes the new set instead.
 */
export async function refreshSitemapModelSubscriptions(
  options: GenerateSitemapOptions = {},
): Promise<void> {
  const active = runtime;
  const activeScheduler = scheduler;
  if (!active || !activeScheduler) return;
  const generation = lifecycleGeneration;
  const config = resolveSitemapConfig();
  const models = await collectSitemapModelDependencies({
    appRoot: options.appRoot ?? process.cwd(),
    srcDir: options.srcDir,
    locales: config.locales,
    pageSource: options.pageSource,
  });
  const replacement = await subscribeSitemapModels(models, () => activeScheduler.invalidate());
  if (generation !== lifecycleGeneration || runtime !== active || scheduler !== activeScheduler) {
    replacement.dispose();
    return;
  }
  const previous = subscriptions;
  subscriptions = replacement;
  previous?.dispose();
}
/** Compatible public entry point: managed publication result only, never HTTP-triggered. */
export async function regenerateSitemap(
  options: GenerateSitemapOptions = {},
): Promise<SitemapGenerationResult> {
  const config = resolveSitemapConfig();
  if (!config.enabled) return disabledResult();
  if (!runtime) await startSitemapRuntime(options);
  if (!runtime) return disabledResult();
  try {
    const generated = await runtime.request();
    lastFailure = undefined;
    void runtime.store.cleanupRetainedGenerations(generated.manifest).catch(reportFailure);
    return generated.result;
  } catch (error) {
    reportFailure(error);
    throw error;
  }
}

export function getSitemapServingState(): SitemapServingState | undefined {
  return servingState;
}
/** Compatibility surface has no local filesystem artifacts in managed storage mode. */
export function getSitemapArtifacts(): SitemapArtifacts | undefined {
  return undefined;
}
export function getLastSitemapFailure(): SitemapFailure | undefined {
  return lastFailure;
}

export async function shutdownSitemapRuntime(): Promise<void> {
  scheduler?.dispose();
  scheduler = undefined;
  subscriptions?.dispose();
  subscriptions = undefined;
  lifecycleGeneration++;
  runtime?.dispose();
  runtime = undefined;
  servingState = undefined;
}

export function resetSitemapLifecycleForTests(): void {
  void shutdownSitemapRuntime();
  lastFailure = undefined;
}
