import type { FastifyInstance } from "fastify";
import {
  attachAiReports,
  DEVTOOLS_MOUNTED_KEY,
  type DevtoolsAiReports,
  loadAiFeed,
} from "../ai/attach";
import { resolveDevtoolsAiOptions } from "../ai/options";
import { type MountedDevtoolsPanel, productionPanels, withoutDevelopmentAiTabs } from "../panels";
import type { MountDevtoolsRoutesDeps } from "../server/types";
import type { ResolvedDevtoolsOptions } from "../types";
import { DevtoolsProductionConfigError } from "./errors";
import type { DevtoolsInsights } from "./insights/types";
import { resolveProductionOptions } from "./options";
import { describeAiUnavailable, toAiUnavailableView } from "../sources/ai-source";

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

const AI_REPORT_TABS: readonly string[] = ["ai-reports", "ai-models", "ai-errors"];

/** Tells other packages (Panoptic) that devtools is mounted here and where. */
function publishMounted(path: string): void {
  (globalThis as Record<symbol, unknown>)[DEVTOOLS_MOUNTED_KEY] = { path, mode: "production" };
}

function clearMounted(): void {
  delete (globalThis as Record<symbol, unknown>)[DEVTOOLS_MOUNTED_KEY];
}

/**
 * Loads the AI feed and starts this process's rollup writer (every process of
 * a deployment adds into the same table). Never throws: a failure leaves the
 * AI report tabs answering their unavailable view.
 */
async function attachProductionAi(
  options: ResolvedDevtoolsOptions,
  warn: (message: string) => void,
): Promise<{ feedAvailable: boolean; reports: DevtoolsAiReports }> {
  const loaded = await loadAiFeed();

  if ("unavailable" in loaded) {
    return { feedAvailable: false, reports: { ...loaded.unavailable, async dispose() {} } };
  }

  try {
    return {
      feedAvailable: true,
      reports: await attachAiReports({
        feed: loaded.feed,
        options: resolveDevtoolsAiOptions(options.ai, "production"),
        warn,
      }),
    };
  } catch (error) {
    warn(`AI reports could not start: ${error instanceof Error ? error.message : String(error)}`);

    return {
      feedAvailable: true,
      reports: { ...toAiUnavailableView(describeAiUnavailable("reports-off")), async dispose() {} },
    };
  }
}

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
): Promise<() => Promise<void>> {
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
    const { builtIn: requestedTabs, panels } = productionPanels(input.panels, production.panels);

    // Runs and Agents read per-process run details, which production does not keep (it keeps hourly totals).
    const { builtIn: shownTabs, ignored: ignoredAiTabs } = withoutDevelopmentAiTabs(
      requestedTabs,
      production.panels,
    );

    if (ignoredAiTabs.length > 0) {
      warn(
        "The Runs and Agents tabs are development tabs, so production.panels.ai and production.panels.agents are ignored. Production shows AI totals in Reports, Models and Errors.",
      );
    }

    // The AI report tabs are listed only when the app has the AI feed (Panoptic), unless the project turned one on.
    // With every report tab turned off, no totals are written (and no missing-table warning is logged).
    const aiWiring = shownTabs.some((tab) => AI_REPORT_TABS.includes(tab))
      ? await attachProductionAi(options, warn)
      : {
          feedAvailable: false,
          reports: {
            ...toAiUnavailableView(describeAiUnavailable("reports-off")),
            async dispose() {},
          },
        };
    const builtIn = aiWiring.feedAvailable
      ? shownTabs
      : shownTabs.filter((tab) => !AI_REPORT_TABS.includes(tab) || production.panels[tab] === true);

    stops.push(() => aiWiring.reports.dispose());

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
        aiReports: aiWiring.reports,
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
      ...(typeof core.answerUnknownUrl === "function"
        ? { answerUnknownUrl: core.answerUnknownUrl }
        : {}),
      hmac: (value) => crypto.hmac(value),
    });

    publishMounted(production.path);
    stops.push(clearMounted);

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

  // Returns the promise of the stops so the connector can wait for the final AI totals flush.
  return () => {
    const finished: Promise<unknown>[] = [];

    for (const stop of stops.splice(0).reverse()) {
      try {
        finished.push(Promise.resolve(stop()).catch(() => undefined));
      } catch {
        // Shutdown continues past a failing step.
      }
    }

    finished.push(capture.dispose().catch(() => undefined));

    return Promise.all(finished).then(() => undefined);
  };
}
