import type {
  DevtoolsAiRollupDelta,
  DevtoolsAiRollupWriter,
  DevtoolsAiRollupWriterInput,
} from "../types";
import { addRollupCounters, rollupId, traceToRollupDeltas } from "./extract";
import { DevtoolsAiRollupIncrementError } from "./increment-error";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PRUNE_EVERY_MS = 10 * 60_000;
const WARN_EVERY_MS = 60_000;
const STOP_GRACE_MS = 5000;
const DEFAULT_MAX_KEYS = 2000;

/**
 * Starts the rollup writer: `record(trace)` adds the trace's deltas to an
 * in-memory map keyed by `rollupId`; every `options.flushIntervalMs` the map
 * is swapped out and written with `store.increment` (a failed write merges
 * the unsaved deltas back for the next try, only those when the store says
 * which, and warns at most once a minute); every
 * 10 minutes it prunes hours older than `options.retentionDays`. Timers are
 * `unref`ed and writes are serialised (never two at once). `stop()` clears
 * the timers and flushes, giving up after 5 seconds.
 */
export function startAiRollupWriter(input: DevtoolsAiRollupWriterInput): DevtoolsAiRollupWriter {
  const { store, totalCost, options } = input;
  const now = input.now ?? Date.now;
  const warn = input.warn ?? ((message: string) => console.warn(message));
  const maxKeys = input.maxKeys ?? DEFAULT_MAX_KEYS;

  let pending = new Map<string, DevtoolsAiRollupDelta>();
  // The batch being written: still shown by `pending()` until the write settles, so reports never dip.
  let writing: readonly DevtoolsAiRollupDelta[] = [];
  let inflight: Promise<void> = Promise.resolve();
  let lastWarnAt: number | undefined;

  const warnOnce = (task: string, error: unknown): void => {
    const at = now();

    if (lastWarnAt !== undefined && at - lastWarnAt < WARN_EVERY_MS) return;

    lastWarnAt = at;

    const reason = error instanceof Error ? error.message : String(error);

    warn(`Devtools could not ${task}: ${reason}. It will try again.`);
  };

  /** Adds a delta, folding a new key into agent `(other)` once `maxKeys` is reached. */
  const add = (delta: DevtoolsAiRollupDelta): void => {
    let id = rollupId(delta);
    let target = pending.get(id);
    let source = delta;

    if (!target && pending.size >= maxKeys) {
      source = { ...structuredClone(delta), agent: "(other)" };
      id = rollupId(source);
      target = pending.get(id);
    }

    if (target) {
      addRollupCounters(target, source);
    } else {
      pending.set(id, structuredClone(source));
    }
  };

  const writeNow = async (): Promise<void> => {
    if (pending.size === 0) return;

    const batch = [...pending.values()];

    pending = new Map();
    writing = batch;

    try {
      await store.increment(batch);
    } catch (error) {
      // Only what was not saved goes back: a partly saved batch must never be added twice.
      const unsaved = error instanceof DevtoolsAiRollupIncrementError ? error.unwritten : batch;

      for (const delta of unsaved) add(delta);

      warnOnce("save AI totals", error);
    } finally {
      writing = [];
    }
  };

  const flush = (): Promise<void> => {
    inflight = inflight.then(writeNow);

    return inflight;
  };

  const prune = async (): Promise<void> => {
    try {
      const cutoff = Math.floor(now() / HOUR_MS) * HOUR_MS - options.retentionDays * DAY_MS;

      await store.prune(cutoff);
    } catch (error) {
      warnOnce("remove old AI totals", error);
    }
  };

  const flushTimer = setInterval(() => void flush(), options.flushIntervalMs);
  const pruneTimer = setInterval(() => void prune(), PRUNE_EVERY_MS);

  flushTimer.unref();
  pruneTimer.unref();

  return {
    record(trace) {
      try {
        for (const delta of traceToRollupDeltas(trace, totalCost)) add(delta);
      } catch {
        // A trace that cannot be summarised must never reach the trace publisher.
      }
    },
    pending() {
      return [...writing, ...pending.values()].map((delta) => structuredClone(delta));
    },
    flush,
    async stop() {
      clearInterval(flushTimer);
      clearInterval(pruneTimer);

      let timer: NodeJS.Timeout | undefined;
      const giveUp = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_GRACE_MS);
        timer.unref();
      });

      try {
        await Promise.race([flush(), giveUp]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
