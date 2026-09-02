import config from "@mongez/config";
import { assertPortIsAvailable, PortInUseError } from "./port-preflight";

/**
 * Host used when `http.host` is unset — the same default `HttpConnector`
 * binds with, so the probe tests the address the server will actually take.
 */
const DEFAULT_BIND_HOST = "localhost";

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

  const port = Number(httpConfig.port);

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
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

    process.exit(1);
  }
}

/**
 * Print the collision the way the developer needs to read it: the errno they
 * grep for, the port and host by name, and the command that names the process
 * holding it — the supervisor cannot discover the owning PID for them, but it
 * can hand them the one line that will.
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
    `  then stop it, or change http.port in src/config/http.ts and rebuild.`,
    "",
  ];

  for (const line of lines) {
    console.error(line);
  }
}
