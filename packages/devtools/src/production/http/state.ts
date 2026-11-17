import { createHash } from "node:crypto";
import type { DevtoolsStore } from "../store/types";
import type { DevtoolsDashboardState } from "./types";

/** SHA-256 hex of a dashboard path: what `disabledPathHash` holds. */
export function hashDashboardPath(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

/**
 * The open/closed state with a `ttlMs` cache (default 5000). Open means the
 * dashboard is not disabled for this path and not locked. A failed read is
 * not cached and rejects, so the caller can fail closed.
 */
export function createDashboardState(
  store: DevtoolsStore,
  path: string,
  options: { ttlMs?: number; now?: () => number } = {},
): DevtoolsDashboardState {
  const ttlMs = options.ttlMs ?? 5000;
  const now = options.now ?? Date.now;
  const pathHash = hashDashboardPath(path);
  let cached: { open: boolean; at: number } | null = null;
  let pending: Promise<boolean> | null = null;
  let generation = 0;

  const read = async (): Promise<boolean> => {
    const started = generation;
    const state = await store.state.read();
    const at = now();
    const disabled = state.disabled && state.disabledPathHash === pathHash;
    const locked = state.lockedUntil !== null && state.lockedUntil > at;
    const open = !disabled && !locked;

    if (started === generation) cached = { open, at };

    return open;
  };

  return {
    async isOpen() {
      if (cached !== null && now() - cached.at < ttlMs) return cached.open;

      if (pending === null) {
        const current = read().finally(() => {
          if (pending === current) pending = null;
        });

        pending = current;
      }

      return pending;
    },
    invalidate() {
      generation += 1;
      cached = null;
      pending = null;
    },
  };
}
