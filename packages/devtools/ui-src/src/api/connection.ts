import { useSyncExternalStore } from "react";

/**
 * Whether the dashboard can reach the app. A network failure, a gateway
 * answer (502/503/504) or a dropped live stream marks the connection down;
 * a probe of `api/auth/session` retries with backoff (1 s doubling to 10 s)
 * until the app answers. Then the state reads "restored" for a few seconds
 * and `generation` grows, which makes every data hook fetch again.
 */

export type ConnectionPhase = "online" | "down" | "restored";

export type ConnectionState = {
  phase: ConnectionPhase;
  /** When the outage began (ms since epoch); 0 while online. */
  since: number;
  /** Grows by one each time the connection comes back. */
  generation: number;
  /** Probes made during the current outage. */
  attempts: number;
};

const PROBE_PATH = "api/auth/session";
const FIRST_DELAY = 1000;
const MAX_DELAY = 10_000;
const RESTORED_MS = 3000;

const initial: ConnectionState = { phase: "online", since: 0, generation: 0, attempts: 0 };

let state: ConnectionState = initial;
let probeTimer: ReturnType<typeof setTimeout> | undefined;
let restoredTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: ConnectionState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** True for failures that mean "the app is not answering", not "the app said no". */
export function isConnectionFailure(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

export function getConnection(): ConnectionState {
  return state;
}

export function isDown(): boolean {
  return state.phase === "down";
}

function schedule(delay: number): void {
  probeTimer = setTimeout(() => {
    void probe(delay);
  }, delay);
}

async function probe(delay: number): Promise<void> {
  if (state.phase !== "down") return;

  let alive = false;

  try {
    const response = await fetch(PROBE_PATH, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    alive = !isConnectionFailure(response.status);
  } catch {
    alive = false;
  }

  if (state.phase !== "down") return;

  if (alive) {
    reportSuccess();

    return;
  }

  set({ ...state, attempts: state.attempts + 1 });
  schedule(Math.min(delay * 2, MAX_DELAY));
}

/** The app did not answer: show the banner and start probing. */
export function reportFailure(): void {
  if (state.phase === "down") return;

  if (restoredTimer) clearTimeout(restoredTimer);

  set({ ...state, phase: "down", since: Date.now(), attempts: 0 });
  schedule(FIRST_DELAY);
}

/** The app answered: if it was down, announce the return and trigger refetches. */
export function reportSuccess(): void {
  if (state.phase !== "down") return;

  if (probeTimer) clearTimeout(probeTimer);

  set({ ...state, phase: "restored", generation: state.generation + 1 });
  restoredTimer = setTimeout(() => {
    if (state.phase === "restored") set({ ...state, phase: "online", since: 0, attempts: 0 });
  }, RESTORED_MS);
}

/** Subscribes to the state (React and tests). */
export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(subscribeConnection, getConnection, getConnection);
}

/** Returns to the online state and stops every timer. Specs call this between tests. */
export function resetConnection(): void {
  if (probeTimer) clearTimeout(probeTimer);
  if (restoredTimer) clearTimeout(restoredTimer);

  state = initial;
  for (const listener of listeners) listener();
}
