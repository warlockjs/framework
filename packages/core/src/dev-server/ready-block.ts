import { colors } from "@mongez/copper";
import { Application } from "../application";
import { connectorsManager } from "../connectors/connectors-manager";
import { getHttpReadyReport, type HttpReadyReport } from "../http/ready-report";

/**
 * The one screen `warlock dev` exists to print.
 *
 * ## What was wrong with the lines this replaces
 *
 * Every fact was announced by whichever component discovered it, the moment it
 * discovered it, in that component's own format:
 *
 *     ℹ info    (21:28:36.095) [http] [routes] 14 route(s) registered
 *     ✓ success (21:28:36.118) [http] [connection] Server ready at http://[::1]:2030
 *     21:28:36  ➜  Development Server is ready in 660.72ms
 *
 * The ORDER of that output is the order the work finished in, which is not a
 * fact about the application and changes between runs. There was no single
 * place stating where to point a browser, and the one URL on screen was an IPv6
 * literal most terminals will not linkify. This is a screen a developer reads a
 * hundred times a day.
 *
 * So the facts are collected (`http/ready-report.ts`) and rendered once, here,
 * after boot has actually completed.
 *
 * ## The rule this file must not break
 *
 * **Warnings never move into the block.** They are logged by whoever found them
 * at the moment they were found, which puts them ABOVE this block — visible,
 * out of the summary, and impossible to mistake for decoration. A block that
 * absorbs warnings is a block that hides them, and this file is deliberately
 * incapable of receiving one: nothing in {@link ReadyBlockFacts} can carry a
 * warning.
 *
 * ## Why the URL is not the address that was bound
 *
 * `listen()` returns what it bound (`http://[::1]:2030` for a dual-stack
 * `localhost`). The block shows `http://localhost:2030`, which resolves back to
 * that exact socket. The transform is display-only and lives in
 * `connectors/describe-server-address.ts`; nothing here touches `host`, and the
 * set of interfaces the server accepts on is unchanged.
 */

export type ReadyBlockFacts = {
  /** The bound HTTP surface, or `undefined` for a process with no HTTP server. */
  http?: HttpReadyReport;
  /** Whether a web/SSR surface (the `web` connector) serves on the same origin. */
  hasWebSurface: boolean;
  /** `development` / `production` / `test`. */
  mode: string;
  /** How long the boot took, when the caller measured it. */
  bootDurationMs?: number;
};

/** Collect the facts from the places that own them. Pure read, no printing. */
export function collectReadyBlockFacts(bootDurationMs?: number): ReadyBlockFacts {
  return {
    http: getHttpReadyReport(),
    // The web connector serves pages on the SAME origin as the API — one port
    // serves everything in v5 — so its presence is what makes the "Web" row
    // true, not a second address. Showing the row unconditionally would tell an
    // API-only app it has a page surface it does not have.
    hasWebSurface: connectorsManager.list().some((connector) => connector.name === "web"),
    mode: Application.environment,
    bootDurationMs,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms > 60_000) return `${(ms / 60_000).toFixed(2)}m`;

  return `${(ms / 1000).toFixed(2)}s`;
}

/** `  ➜  App      http://localhost:2042` */
function urlRow(label: string, url: string, note?: string): string {
  const suffix = note ? ` ${colors.dim(note)}` : "";

  return `  ${colors.green("➜")}  ${colors.bold(label.padEnd(8))}${colors.cyan(url)}${suffix}`;
}

/** `Port` `2042`, joined into one dim summary line. */
function factRow(pairs: [string, string][]): string {
  const rendered = pairs.map(([key, value]) => `${colors.dim(key)} ${colors.white(value)}`);

  return `     ${rendered.join(colors.dim("  ·  "))}`;
}

/**
 * Render the block as lines. Separated from printing so a test can assert the
 * exact content without capturing stdout, and so the renderer stays pure.
 */
export function renderReadyBlock(facts: ReadyBlockFacts): string[] {
  const lines: string[] = [""];

  if (facts.http) {
    // A wildcard bind reaches more than loopback. `localhost` is still correct
    // and still reaches it, but the reader is told the bind is wider rather
    // than left to infer it from a URL that no longer says so.
    const note = facts.http.wildcardBind ? "(all interfaces)" : undefined;

    lines.push(urlRow("App", facts.http.url, note));

    if (facts.hasWebSurface) {
      // Same origin, deliberately: pages and API share one port. Repeating the
      // URL is not redundancy here — it answers "where do I open the site?"
      // without the reader having to know that.
      lines.push(urlRow("Web", facts.http.url));
    }

    if (facts.http.publicUrl) {
      // `publicUrl` arrives pre-labelled from `describeServerAddress`; the block
      // supplies its own label, so strip the prose and keep the address.
      const address = facts.http.publicUrl.replace(/^[^:]*:\s*/, "");
      lines.push(urlRow("Public", address));
    }
  }

  const pairs: [string, string][] = [];

  if (facts.http) {
    pairs.push(["port", String(facts.http.port)]);
  }

  pairs.push(["mode", facts.mode]);

  if (facts.http) {
    pairs.push(["routes", String(facts.http.routeCount)]);
  }

  if (facts.bootDurationMs !== undefined) {
    pairs.push(["ready in", formatDuration(facts.bootDurationMs)]);
  }

  lines.push(factRow(pairs));
  lines.push("");

  return lines;
}

/** Collect, render, print. The only function the dev server needs. */
export function printReadyBlock(bootDurationMs?: number): void {
  for (const line of renderReadyBlock(collectReadyBlockFacts(bootDurationMs))) {
    console.log(line);
  }
}
