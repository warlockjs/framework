import { cache } from "@warlock.js/cache";
import { log } from "@warlock.js/logger";
import { config } from "../config";
import { type RegisteredUseCase, type UseCaseConfigurations, type UseCaseResult } from "./types";

/**
 * Store registered use cases
 */
const useCaseRegister = new Map<string, RegisteredUseCase>();

/**
 * Register a use case
 */
export function $registerUseCase<Output, Input>(
  name: string,
  useCase: RegisteredUseCase<Output, Input>,
) {
  if (useCaseRegister.has(name) && process.env.NODE_ENV !== "production") {
    log.warn("use-cases", "registering", `Use case "${name}" is already registered. Overwriting.`);
  }

  useCaseRegister.set(name, useCase);
}

/**
 * Unregister a use case.
 *
 * Dropping the history namespace is best-effort: `$cleanup` is synchronous, so the
 * async cache removal is fire-and-forget with a `.catch` guard — a rejecting cache
 * driver must never turn cleanup into an unhandled rejection.
 */
export function $unregisterUseCase(name: string) {
  useCaseRegister.delete(name);

  Promise.resolve(cache.removeNamespace(`use-case:history:${name}`)).catch((error) => {
    log.error("use-cases", name, "history namespace removal failed", { error });
  });
}

/**
 * Get a use case.
 *
 * Returns the `RegisteredUseCase` shape — including the runtime `calls` counters
 * the registry actually stores — so consumers can read call stats without an
 * ad-hoc cast.
 */
export function getUseCase<Output, Input>(name: string) {
  return useCaseRegister.get(name) as RegisteredUseCase<Output, Input> | undefined;
}

/**
 * Get all use cases
 */
export function getUseCases() {
  return useCaseRegister;
}

/**
 * Increase use case success calls
 */
export function increaseUseCaseSuccessCalls(name: string): number {
  const useCase = useCaseRegister.get(name);
  if (useCase) {
    useCase.calls.success++;
    useCase.calls.total++;

    return useCase.calls.success;
  }

  return 0;
}

/**
 * Increase use case failed calls
 */
export function increaseUseCaseFailedCalls(name: string): number {
  const useCase = useCaseRegister.get(name);
  if (useCase) {
    useCase.calls.failed++;
    useCase.calls.total++;

    return useCase.calls.failed;
  }

  return 0;
}

/**
 * Resolve the history cache TTL (seconds) from config.
 * `false` means "use the cache driver's default", represented as `undefined`.
 */
function resolveHistoryTtl(useCaseConfig?: UseCaseConfigurations): number | undefined {
  const ttlConfig = useCaseConfig?.history?.ttl ?? 3600; // 1 hour default

  return ttlConfig === false ? undefined : ttlConfig;
}

/**
 * Get use case history from cache.
 *
 * Prunes ids whose entries have expired so the list can't accumulate dead refs.
 */
export async function getUseCaseHistory(name: string): Promise<UseCaseResult<any>[]> {
  const listKey = `use-case:history:${name}:list`;
  const ids = (await cache.get<string[]>(listKey)) || [];

  const entries = await Promise.all(
    ids.map(async (id: string) => ({
      id,
      result: await cache.get<UseCaseResult<any>>(`use-case:history:${name}:${id}`),
    })),
  );

  const liveEntries = entries.filter((entry) => Boolean(entry.result));

  if (liveEntries.length !== ids.length) {
    const useCaseConfig = config.get<UseCaseConfigurations>("use-cases");

    await cache.set(
      listKey,
      liveEntries.map((entry) => entry.id),
      resolveHistoryTtl(useCaseConfig),
    );
  }

  return liveEntries.map((entry) => entry.result) as UseCaseResult<any>[];
}

/**
 * Add use case history to cache, capping the per-use-case list so it can't grow
 * unbounded — oldest entries (and their ids) are evicted past MAX_HISTORY_ENTRIES.
 */
export async function addUseCaseHistory(name: string, result: UseCaseResult<any>) {
  const useCaseConfig = config.get<UseCaseConfigurations>("use-cases");

  // On by default outside production; opt in to production with `history.enabled: true`.
  const enabled = useCaseConfig?.history?.enabled ?? process.env.NODE_ENV !== "production";

  if (!enabled) return;

  const previous = historyWrites.get(name) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeHistory(name, result));

  historyWrites.set(name, current);

  try {
    await current;
  } finally {
    if (historyWrites.get(name) === current) {
      historyWrites.delete(name);
    }
  }
}

/**
 * Per-use-case write chain so the list read-modify-write never interleaves
 * within a process (keeps the cap enforced under concurrency).
 */
const historyWrites = new Map<string, Promise<unknown>>();

async function writeHistory(name: string, result: UseCaseResult<any>) {
  const useCaseConfig = config.get<UseCaseConfigurations>("use-cases");
  const ttl = resolveHistoryTtl(useCaseConfig);
  const maxEntries = useCaseConfig?.history?.maxEntries ?? 100;
  const key = `use-case:history:${name}:${result.id}`;
  const listKey = `use-case:history:${name}:list`;

  // Store a projection only: `output` and `ctx` (tokens, payloads) never reach the cache.
  const projection = { ...result, output: undefined, ctx: undefined } as unknown as UseCaseResult<any>;

  await cache.set(key, projection, ttl);

  const list = (await cache.get<string[]>(listKey)) || [];

  list.push(result.id);

  while (list.length > maxEntries) {
    const evictedId = list.shift();

    if (evictedId) {
      await cache.remove(`use-case:history:${name}:${evictedId}`);
    }
  }

  await cache.set(listKey, list, ttl);
}
