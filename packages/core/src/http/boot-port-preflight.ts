import config from "@mongez/config";
import { getRecordedEnvironmentOverride } from "../utils/recorded-environment-overrides";
import { assertPortIsAvailable, PortInUseError } from "./port-preflight";
import { resolveBindPort } from "./resolve-bind-port";

/**
 * The env var whose value `src/config/http.ts` reads for `http.port`
 * (`port: env("HTTP_PORT", …)`). When an ambient value for it beats `.env`,
 * `http.port` resolves to the ambient value and editing the config literal
 * changes nothing — the whole point of the provenance branch below.
 */
const HTTP_PORT_ENV_KEY = "HTTP_PORT";

/**
 * Mirrors `dev-server/supervisor.ts`'s `BOOT_PRECONDITION_EXIT_CODE`. Kept as
 * its own literal here (rather than imported) so this file — reached by both
 * the dev-preload path and the generated, standalone production entry — never
 * pulls dev-server's supervisor module (child_process, TTY handling, ...)
 * into a production bundle that has no supervisor at all. EX_CONFIG.
 */
const BOOT_PRECONDITION_EXIT_CODE = 78;

/**
 * Host used when `http.host` is unset — the same default `HttpConnector`
 * binds with, so the probe tests the address the server will actually take.
 */
const DEFAULT_BIND_HOST = "localhost";

/**
 * Whether the HTTP-port preflight should run for a command's `connectors`
 * preload.
 *
 * The bind-and-release probe is only meaningful when this boot will actually
 * start the http connector: `true` (a full boot — http starts in its late
 * phase) or an explicit list that names `"http"`. A scoped list WITHOUT http —
 * e.g. `warlock seed`'s `["database", "cache", "logger"]`, or `migrate` — never
 * binds the port, so probing it is pointless and actively harmful: the probe
 * collides with a dev server already listening on that port (and inherits a
 * stray `HTTP_PORT`), so a read-only data command fails on a port it was never
 * going to use. Finding f9ace89e.
 */
export function shouldPreflightHttpPort(connectors: readonly string[] | true): boolean {
  return connectors === true || connectors.includes("http");
}

/**
 * Probe the port declared in `src/config/http.ts`, if there is one.
 *
 * Reads config rather than taking arguments because the only honest answer to
 * "which port will this boot bind" lives in the loaded config, and the callers
 * that need this check (the generated production entry) run before anything
 * that could hand it over.
 *
 * A no-op for an app with no `http` config, or an `http.port` that is not a
 * usable port number — those apps never bind, so there is nothing to preflight
 * and nothing to fail on.
 *
 * @throws {PortInUseError} when the configured port is already taken.
 */
export async function assertConfiguredHttpPortIsFree(): Promise<void> {
  const httpConfig = config.get("http");

  if (!httpConfig) {
    return;
  }

  // This runs BEFORE the connectors in the generated production entry, and
  // `preflightConfiguredHttpPort()` below only exits on `PortInUseError` —
  // any other throw is swallowed there. So a bad port must not throw HERE:
  // it stays a no-op, exactly like the previous hand-rolled coercion, and
  // `HttpConnector` (which now also calls `resolveBindPort`) is the one that
  // reports it, a moment later, with a channel a developer will actually see.
  let port: number;

  try {
    port = resolveBindPort(httpConfig.port);
  } catch {
    return;
  }

  // Port 0 asks the OS to pick a free one, so there is nothing to preflight:
  // probing 0 binds SOME unrelated ephemeral port and "passes" without proving
  // anything about the port this boot will end up on. The hand-rolled coercion
  // this replaced skipped 0 by rejecting `port <= 0`; `resolveBindPort` accepts
  // 0 as a legitimate TCP value, so the skip has to be stated here instead of
  // falling out of a range check.
  if (port === 0) {
    return;
  }

  await assertPortIsAvailable(port, httpConfig.host || DEFAULT_BIND_HOST);
}

/**
 * Fail the boot immediately, and by name, when the http port is already taken.
 *
 * Called from the generated production entry BEFORE the early-phase connectors,
 * because the port is the cheapest thing in the boot to check and the one most
 * likely to be wrong. `HttpConnector` is a LATE-phase connector, so its own
 * preflight is not reached until the database has connected, the cache has
 * connected and every module of app code has been imported — 7-13 seconds of
 * work, all of it discarded, before anyone learns the port was busy. This check
 * costs a bind-and-release on a socket that is never served.
 *
 * It does NOT replace `HttpConnector`'s preflight: a port can be taken in the
 * seconds between the two, and only the connector's check sits immediately
 * before the real `listen()`. This one exists to make the common case fast and
 * legible.
 *
 * Reports through `console.error` and NOT through `log.fatal`: the logger has
 * no channels yet at this point in the boot (the logger connector is part of
 * the early phase this runs ahead of), so a logged message here would reach
 * nobody. stderr always reaches the terminal, and `warlock start` forwards the
 * child's stderr verbatim.
 *
 * A probe that fails for any OTHER reason is deliberately swallowed: this is a
 * fast-fail convenience, and it must never be the thing that stops an app which
 * would otherwise have booted. `HttpConnector` still runs the real check.
 */
export async function preflightConfiguredHttpPort(): Promise<void> {
  try {
    await assertConfiguredHttpPortIsFree();
  } catch (error) {
    if (!(error instanceof PortInUseError)) {
      return;
    }

    reportPortInUse(error);

    process.exit(BOOT_PRECONDITION_EXIT_CODE);
  }
}

/**
 * Print the collision the way the developer needs to read it: the errno they
 * grep for, the port and host by name, and the command that names the process
 * holding it — the supervisor cannot discover the owning PID for them, but it
 * can hand them the one line that will.
 *
 * The remedy is chosen by PROVENANCE, never appended as a menu. When the
 * colliding port came from an ambient `HTTP_PORT` that beat `.env` (the exact
 * two-rebuild trap of finding 8782b840), "edit src/config/http.ts and rebuild"
 * is actively wrong — the env var wins, so the rebuild changes nothing. In that
 * case name the variable and give the remedy that works (unset it); only when
 * the port genuinely came from config do we point at the config file.
 */
function reportPortInUse(error: PortInUseError): void {
  const ownerCommand =
    process.platform === "win32"
      ? `netstat -ano | findstr :${error.port}`
      : `lsof -i :${error.port}`;

  const lines = [
    "",
    `  ✖ EADDRINUSE: port ${error.port} is already in use on ${error.host}`,
    `  the application cannot start because something else is already listening there.`,
    `  find the owning process: ${ownerCommand}`,
    ...remedyLines(error.port),
    "",
  ];

  for (const line of lines) {
    console.error(line);
  }
}

/**
 * The remedy lines, chosen by where `http.port` actually came from.
 *
 * The provenance is the detector's own finding from env-load, carried here via
 * {@link getRecordedEnvironmentOverride} rather than recomputed — so this asks
 * "did an ambient HTTP_PORT beat .env, and is that the value now colliding?"
 * and, only when the answer is yes, replaces the config-edit advice with the
 * one that will actually free the port.
 */
export function remedyLines(collidingPort: number): string[] {
  const httpPortOverride = getRecordedEnvironmentOverride(HTTP_PORT_ENV_KEY);

  // Only claim the environment is the source when the ambient value is the one
  // that is actually colliding — an HTTP_PORT override of an UNRELATED port
  // must not misdirect the reader away from their real (config) port.
  const cameFromEnvironment =
    httpPortOverride !== undefined &&
    Number(String(httpPortOverride.effectiveValue).trim()) === collidingPort;

  if (cameFromEnvironment) {
    return [
      `  this port came from the ${HTTP_PORT_ENV_KEY} environment variable (=${httpPortOverride!.effectiveValue}), which overrode .env's ${HTTP_PORT_ENV_KEY}=${httpPortOverride!.fileValue}.`,
      `  editing src/config/http.ts and rebuilding will NOT change it — the environment variable wins.`,
      `  then stop the process above, or unset ${HTTP_PORT_ENV_KEY} and run again.`,
    ];
  }

  return [`  then stop it, or change http.port in src/config/http.ts and rebuild.`];
}
