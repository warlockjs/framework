/**
 * What the HTTP connector learned at the moment it finished binding.
 *
 * ## Why this exists rather than another `log.*` call
 *
 * The facts a developer needs on a `warlock dev` boot — the URL, the port, the
 * mode, how many routes registered — are discovered by DIFFERENT components at
 * DIFFERENT times, and each one used to print the instant it knew. The result
 * was a ready "screen" assembled by whatever finished first:
 *
 *     ℹ info    [http] [routes] 14 route(s) registered
 *     ✓ success [http] [connection] Server ready at http://[::1]:2030
 *     …          Development Server is ready in 660ms
 *
 * Three lines, three formats, no single place stating where to point a browser.
 *
 * So the connector RECORDS instead of narrating, and one renderer prints one
 * block once boot has actually completed (`dev-server/ready-block.ts`). The
 * split matters: a component that prints cannot be composed, and a boot
 * sequence whose output order is its completion order cannot be read.
 *
 * ## What deliberately does NOT go through here
 *
 * Warnings. A status block is a summary of the healthy case, and folding a
 * warning into a summary is how a warning stops being read. Anything the
 * connector needs to WARN about is still logged the moment it is known, which
 * puts it above the block, where it survives being skimmed.
 *
 * Production is unchanged for the same reason it always was: `warlock start`
 * hands its stdout to a supervisor that greps for known lines, so the existing
 * per-fact log lines stay exactly as they are outside development.
 */

export type HttpReadyReport = {
  /** Exactly what `listen()` returned — the bind, not its presentation. */
  boundAddress?: string;
  /** The address spelled for a human; safe to paste into a browser. */
  url: string;
  /** Whether the bind covers more than loopback. */
  wildcardBind: boolean;
  /** The port actually bound. */
  port: number;
  /** Routes on the app router at the moment the server started listening. */
  routeCount: number;
  /** `app.baseUrl`, when it is a deployment address rather than a local one. */
  publicUrl?: string;
};

let report: HttpReadyReport | undefined;

/**
 * @internal Called by `HttpConnector.start()` right after a successful listen.
 */
export function setHttpReadyReport(next: HttpReadyReport): void {
  report = next;
}

/**
 * The last recorded bind, or `undefined` for a process with no HTTP surface —
 * a queue worker still boots, and the ready block must render without an app
 * URL rather than invent one.
 */
export function getHttpReadyReport(): HttpReadyReport | undefined {
  return report;
}

/** @internal Test seam — a module-level singleton needs a way back to empty. */
export function resetHttpReadyReport(): void {
  report = undefined;
}
