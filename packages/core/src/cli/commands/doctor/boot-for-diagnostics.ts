import { config } from "../../../config/config-getter";
import { connectorsManager } from "../../../connectors/connectors-manager";
import { registerConfiguredConnectors } from "../../../connectors/register-configured-connectors";
import { ConnectorLifecyclePhase } from "../../../connectors/types";
import { container } from "../../../container";
import { filesOrchestrator } from "../../../dev-server/files-orchestrator";
import { ModuleLoadError } from "../../../dev-server/module-loader";
import { router } from "../../../router/router";
import type { DoctorBootContext, ModuleFailure } from "./check.types";

/**
 * @fileoverview The boot pass `warlock doctor` runs before its checks.
 *
 * THE RULE: **doctor boots, it never starts.**
 *
 * The connector contract already splits the two things doctor needs to keep
 * apart. `boot()` is where a connector REGISTERS — the HTTP connector builds a
 * Fastify instance and adds `/health` + `/ready` to it, the web connector
 * installs one route per page on the app router — and `start()` is where it
 * CONNECTS: opens the database, dials the cache, binds the port. Doctor runs
 * every `boot()` and no `start()`, so it sees the exact surface a served app
 * would have while opening no connection and binding no port.
 *
 * That seam is what makes the checks true. Before it existed here, doctor
 * preloaded config and framework bootstrap only: no app module was ever
 * imported, so no route module ever ran, so `routes` reported `0` on an app
 * `warlock dev` served 14 routes for — while `health` reported the endpoints as
 * "registered" from a config flag alone. Two checks, one app, contradictory
 * answers, and the wrong one was the one users acted on.
 *
 * ORDERING mirrors `DevelopmentServer.start()` exactly, because the route
 * surface is order-dependent: early connectors boot, then models (decorator
 * registries the route modules resolve against), then locales/events/mains/
 * routes, then late connectors — which is where `web` turns pages into routes.
 * Get the order wrong and the count is wrong, which is the defect this replaces.
 *
 * NOT read-only in one narrow sense: it imports the app's own modules, so
 * whatever a module does at import time happens. That is unavoidable — routes
 * only exist as the side effect of importing the file that declares them — and
 * it is the same import the dev server performs. It also refreshes
 * `.warlock/manifest.json`, the framework's own file cache. Nothing in the
 * app's data, and no network, is touched.
 */

/**
 * The one connector whose `boot()` can bind a port. See {@link shouldSkipBoot}.
 */
const SOCKET_CONNECTOR = "socket";

/**
 * Normalize anything thrown into a one-line message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether doctor must refuse to boot this connector, and why.
 *
 * Exactly one case, and it is not a taste call: `SocketConnector.boot()` shares
 * the HTTP connector's raw server when there is one, and CREATES its own —
 * `server.listen(socketConfig.port)` — when there is not. The HTTP connector
 * boots first (lower priority number), so the shared path is what normally
 * happens; an app that configures `socket` without `http` is the exception, and
 * for that app booting socket would make a diagnostic command open a listening
 * port. Detected by asking the container what HTTP actually left behind rather
 * than by re-deriving the condition from config.
 */
function shouldSkipBoot(name: string): string | undefined {
  if (name === SOCKET_CONNECTOR && !container.has("http.server")) {
    return "no http connector to share a server with — booting it would bind a port";
  }

  return undefined;
}

/**
 * Boot every registered connector in one lifecycle phase, isolating failures.
 *
 * A connector that throws on boot is recorded and the loop continues: one bad
 * connector must not hide the rest of the report, and "which connector failed
 * to boot" is itself a finding worth printing.
 */
async function bootPhase(
  phase: ConnectorLifecyclePhase,
  connectors: DoctorBootContext["connectors"],
): Promise<void> {
  for (const connector of connectorsManager.list()) {
    if (connector.lifecyclePhase !== phase) continue;

    const skipReason = shouldSkipBoot(connector.name);

    if (skipReason) {
      connectors.skipped.push({ name: connector.name, reason: skipReason });
      continue;
    }

    try {
      await connector.boot();
      connectors.booted.push(connector.name);
    } catch (error) {
      connectors.failures.push({ name: connector.name, message: messageOf(error) });
    }
  }
}

/**
 * Import every app module the dev server imports at boot, collecting failures
 * instead of letting the first one abort the pass.
 *
 * `loadAll()` is deliberately reused rather than reimplemented: it owns the
 * canonical order (locale → event → main → route) and the `withSourceFile`
 * scoping that gives each route its origin file. It aggregates its failures and
 * throws them at the end, which is exactly the shape needed here — every module
 * is attempted, and one broken route file cannot mask another.
 */
async function loadAppModules(): Promise<ModuleFailure[]> {
  try {
    await filesOrchestrator.moduleLoader.loadAll();
    return [];
  } catch (error) {
    if (error instanceof AggregateError) {
      return (error.errors as unknown[]).map((failure) => {
        return failure instanceof ModuleLoadError
          ? { file: failure.file.relativePath, message: messageOf(failure.cause) }
          : { file: "unknown", message: messageOf(failure) };
      });
    }

    return [{ file: "unknown", message: messageOf(error) }];
  }
}

/**
 * Eagerly import model files so the decorator-driven registries the route
 * modules resolve names against are populated first — the same reason
 * `DevelopmentServer.autoDiscoverFiles()` exists, and it must keep the same
 * position in the sequence.
 */
async function discoverModels(): Promise<ModuleFailure[]> {
  const failures: ModuleFailure[] = [];

  for (const file of filesOrchestrator.files.values()) {
    if (file.type !== "model") continue;

    try {
      await filesOrchestrator.moduleLoader.loadModule(file, "model");
    } catch (error) {
      failures.push({
        file: file.relativePath,
        message: error instanceof ModuleLoadError ? messageOf(error.cause) : messageOf(error),
      });
    }
  }

  return failures;
}

/**
 * Run the boot pass and report what it found.
 *
 * Never throws. Every failure mode — a connector array the config manager
 * refuses, a connector that throws on boot, a route module that fails to
 * import — becomes a field on the returned context, which the checks turn into
 * a printed verdict. A diagnostic command that crashes while diagnosing tells
 * the user nothing.
 */
export async function bootForDiagnostics(): Promise<DoctorBootContext> {
  const connectors: DoctorBootContext["connectors"] = {
    registered: [],
    configured: [],
    booted: [],
    skipped: [],
    failures: [],
  };

  const context: DoctorBootContext = {
    booted: false,
    routeModules: 0,
    appRoutes: 0,
    totalRoutes: 0,
    moduleFailures: [],
    connectors,
  };

  try {
    // `init()` is idempotent and the preloader already ran it; calling it again
    // costs nothing and keeps this function honest on its own.
    await filesOrchestrator.init();
    await filesOrchestrator.initializeAll();

    filesOrchestrator.specialFilesCollector.collect(filesOrchestrator.getFiles());

    context.routeModules = filesOrchestrator.specialFilesCollector.getFilesByType("route").length;
  } catch (error) {
    context.moduleFailures.push({ file: "src/", message: messageOf(error) });

    return context;
  }

  // The app's own connectors (`warlock.config.ts > connectors`) must be
  // registered before any phase boots, exactly as the dev preloader does it —
  // otherwise doctor would report on the eleven built-ins alone and miss the
  // connector the app actually configured. This is also the call that refuses a
  // duplicate or reserved connector name, so a config that would crash the next
  // real boot is caught here instead.
  try {
    registerConfiguredConnectors();
  } catch (error) {
    connectors.registrationError = messageOf(error);
  }

  connectors.registered = connectorsManager.list().map((connector) => connector.name);
  connectors.configured = connectors.registered.filter((name) => {
    return !connectorsManager.isBuiltInName(name);
  });

  await bootPhase(ConnectorLifecyclePhase.Early, connectors);

  context.moduleFailures.push(...(await discoverModels()));
  context.moduleFailures.push(...(await loadAppModules()));

  // Snapshot BEFORE the late phase: everything the app's own route modules
  // registered. The difference between this and the total is what connectors
  // contributed (pages, for `web`), and reporting the two separately is what
  // lets a user reconcile doctor's number with the dev server's.
  context.appRoutes = router.routeCount();

  await bootPhase(ConnectorLifecyclePhase.Late, connectors);

  context.totalRoutes = router.routeCount();

  context.booted = true;

  return context;
}

/**
 * Whether the app declares an HTTP surface at all. Checks that only make sense
 * for a served app use this to opt out instead of inventing a verdict.
 */
export function hasHttpConfig(): boolean {
  return Boolean(config.get("http"));
}
