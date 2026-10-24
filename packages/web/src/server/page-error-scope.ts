/**
 * Per-request facts the error log needs but most throw sites do not have at
 * hand: the matched page file, the route and the site. The page route handler
 * opens one scope per request, and `reportServerError` reads it, so a failure
 * reported from deep inside a loader, a defer settlement or the stream is
 * still located without threading those values through every call.
 *
 * Also carries the phase hint: an error thrown by a stage that cannot report
 * for itself (translations, module loading) is tagged with its phase on the
 * way up, and the catch that finally reports it reads the tag.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type PageErrorScope = {
  file?: string;
  routePath?: string;
  routeName?: string;
  site?: string;
  /** Flips once a failure of this request has been logged. */
  reported: boolean;
};

const storage = new AsyncLocalStorage<PageErrorScope>();

const PHASE_TAG = Symbol.for("warlock.web.errorPhase");

export function runInPageErrorScope<T>(scope: Omit<PageErrorScope, "reported">, run: () => T): T {
  return storage.run({ ...scope, reported: false }, run);
}

export function currentPageErrorScope(): PageErrorScope | undefined {
  return storage.getStore();
}

/** Remember which stage `thrown` came out of, unless an inner stage already did. */
export function tagErrorPhase(thrown: unknown, phase: string): void {
  if (typeof thrown !== "object" || thrown === null) return;

  const record = thrown as Record<PropertyKey, unknown>;

  try {
    if (record[PHASE_TAG] === undefined) record[PHASE_TAG] = phase;
  } catch {
    // A frozen error simply keeps the caller's own phase.
  }
}

export function taggedErrorPhase(thrown: unknown): string | undefined {
  if (typeof thrown !== "object" || thrown === null) return undefined;

  const phase = (thrown as Record<PropertyKey, unknown>)[PHASE_TAG];

  return typeof phase === "string" ? phase : undefined;
}

/** Run one stage, tagging whatever it throws with `phase`. */
export async function inErrorPhase<T>(phase: string, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (thrown) {
    tagErrorPhase(thrown, phase);
    throw thrown;
  }
}
