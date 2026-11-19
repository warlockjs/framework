import type { FastifyInstance } from "fastify";
import { type MountedDevtoolsPanel, productionPanels } from "../panels";
import type { MountDevtoolsRoutesDeps } from "../server/types";
import type { DevtoolsDisposer, ResolvedDevtoolsOptions } from "../types";
import { DevtoolsProductionConfigError } from "./errors";
import type { DevtoolsInsights } from "./insights/types";
import { resolveProductionOptions } from "./options";

/** What the connector hands production boot. */
export type BootProductionDevtoolsInput = {
  options: ResolvedDevtoolsOptions;
  env: Readonly<Record<string, string | undefined>>;
  server: FastifyInstance;
  /** Package panels loaded with `mode: "production"` (not yet filtered). */
  panels: readonly MountedDevtoolsPanel[];
  /** The route deps the connector builds for development, reused (requestLog, listRoutes, ai, …). */
  routes: Omit<MountDevtoolsRoutesDeps, "collector" | "options" | "isDevelopment">;
  /** Reads one config value (`encryption.key`); defaults to core's `config.get`. */
  readConfig?: (key: string) => unknown;
  /** Called once the shared insights exist (panels read captured error counts through them). */
  onInsights?: (insights: DevtoolsInsights) => void;
  log: {
    info(module: string, action: string, message: string): unknown;
    warn(module: string, action: string, message: string): unknown;
    error(module: string, action: string, message: string): unknown;
  };
};

/** `/ops-…`: the first part of the path, enough to recognise it and not enough to use it. */
export function maskDashboardPath(path: string): string {
  const match = /^\/[A-Za-z]{1,8}-/.exec(path);

  return `${match ? match[0] : "/"}…`;
}

/** The key core encrypts with: 64 hex characters. */
function hasEncryptionKey(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Starts the production monitor, in this order: resolve options (env) →
 * check `encryption.key` (DT006) → cascade store (DT005) → `store.verify()`
 * (DT008) → `ensureFirstAdmin()` (DT003/DT004) → instance info → capture
 * (attach hooks) → resource monitor, health history, jobs reader → local
 * reporter → report writer → shared insights → `excludeFromRequestLog(path)`
 * → mount. Logs one line with the path masked (`/ops-…`), never the full path.
 * Any `DevtoolsProductionConfigError` propagates: the app does not boot.
 *
 * Returns the disposer the connector calls at shutdown (flush samples, stop
 * timers, detach hooks).
 */
export async function bootProductionDevtools(
  input: BootProductionDevtoolsInput,
): Promise<DevtoolsDisposer> {
  const { options, env, server, log } = input;
  const production = resolveProductionOptions(options.production, env);
  const core = await import("@warlock.js/core");
  const readConfig = input.readConfig ?? ((key: string) => core.config.get(key));

  if (!hasEncryptionKey(readConfig("encryption.key"))) {
    throw new DevtoolsProductionConfigError("DT006");
  }

  const [{ createCascadeStore }, authModule, captureModule, insightsModule, httpModule] =
    await Promise.all([
      import("./store"),
      import("./auth"),
      import("./capture"),
      import("./insights"),
      import("./http"),
    ]);

  const store = await createCascadeStore({ shares: production.share.enabled });

  await store.verify();

  const warn = (message: string): void => {
    log.warn("devtools", "production", message);
  };
  if (production.twoFactor === "off") {
    warn(
      'Two-factor sign-in is off for the dashboard (production.twoFactor is "off"): anyone with a password can sign in. Set it to "admins" or "everyone" to require an authenticator app or passkey.',
    );
  }

  const instance = insightsModule.createInstanceInfo();
  const [crypto, passkeys] = await Promise.all([
    authModule.defaultDevtoolsCrypto(),
    authModule.loadDevtoolsPasskeys(),
  ]);
  const auth = authModule.createDevtoolsAuth({
    store,
    options: production,
    instance,
    crypto,
    passkeys,
    warn,
  });

  await auth.ensureFirstAdmin();

  const isDashboardPath = (path: string): boolean =>
    path === production.path || path.startsWith(`${production.path}/`);
  const capture = captureModule.createProductionCapture({
    options,
    production,
    instance,
    store,
    isDashboardPath,
    warn,
  });
  const stops: (() => unknown)[] = [];

  try {
    stops.push(await capture.attach());

    const resources = insightsModule.createResourceMonitor();
    const health = insightsModule.createHealthHistory();

    resources.start();
    health.start();
    stops.push(
      () => resources.stop(),
      () => health.stop(),
    );

    const reporter = insightsModule.createLocalReporter({
      instance,
      resources,
      health,
      jobs: insightsModule.createJobsReader(),
      queries: capture.queries,
      routes: capture.routes,
      errors: capture.errors,
      logs: capture.logs,
      counters: () => capture.counters(),
    });
    const writer = insightsModule.startReportWriter({ reporter, store, production, warn });

    stops.push(() => writer.stop());

    const insights = insightsModule.createSharedInsights({
      store,
      reporter,
      sampleRate: production.sampleRate,
    });
    input.onInsights?.(insights);

    const state = httpModule.createDashboardState(store, production.path);
    const { builtIn, panels } = productionPanels(input.panels, production.panels);

    // The dashboard's own requests are not worth a line in the request log, and its sign-in bodies must not reach it.
    if (typeof core.excludeFromRequestLog === "function") {
      stops.push(core.excludeFromRequestLog(production.path));
    }

    // Mail previews exist only when the project turned that tab on.
    if (builtIn.includes("mail")) {
      const { attachMailSource } = await import("../sources/mail-source");

      stops.push(await attachMailSource(capture.collector));
    }

    httpModule.mountProductionDevtools(server, {
      routes: {
        ...input.routes,
        collector: capture.collector,
        options,
        isDevelopment: () => false,
      },
      production,
      store,
      auth,
      capture,
      insights,
      instance,
      panels,
      builtInPanels: builtIn,
      state,
      warn,
      hmac: (value) => crypto.hmac(value),
    });

    log.info(
      "devtools",
      "ready",
      `devtools production monitor mounted at ${maskDashboardPath(production.path)} (DEVTOOLS_PATH)`,
    );
  } catch (error) {
    for (const stop of stops.splice(0).reverse()) {
      try {
        void Promise.resolve(stop()).catch(() => undefined);
      } catch {
        // Cleanup after a failed boot must not hide the real error.
      }
    }

    void capture.dispose().catch(() => undefined);

    throw error;
  }

  return () => {
    for (const stop of stops.splice(0).reverse()) {
      try {
        void Promise.resolve(stop()).catch(() => undefined);
      } catch {
        // Shutdown continues past a failing step.
      }
    }

    void capture.dispose().catch(() => undefined);
  };
}
