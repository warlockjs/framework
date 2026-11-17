import type { DevtoolsInstanceInfo } from "../../../src/production/contracts";
import {
  createCaptureEngine,
  type DevtoolsQueryEvent,
} from "../../../src/production/capture/engine";
import type { DevtoolsCaptureDeps } from "../../../src/production/capture/types";
import {
  DEVTOOLS_PRODUCTION_DEFAULTS,
  type ResolvedDevtoolsProductionOptions,
} from "../../../src/production/options";
import { createMemoryStore } from "../../../src/production/store/memory-store";

export const instance: DevtoolsInstanceInfo = {
  id: "host:1:abc",
  label: "host pid 1",
  host: "host",
  pid: 1,
  worker: null,
  startedAt: 1,
  seenAt: 1,
  nodeVersion: "v22.0.0",
};

export function productionOptions(
  overrides: Partial<ResolvedDevtoolsProductionOptions> = {},
): ResolvedDevtoolsProductionOptions {
  const defaults = DEVTOOLS_PRODUCTION_DEFAULTS;

  return {
    path: "/ops-secret-path",
    admin: { email: null, password: null, setupToken: null },
    sampleRate: defaults.sampleRate,
    slowRequestMs: defaults.slowRequestMs,
    slowQueryMs: defaults.slowQueryMs,
    maxRequests: defaults.maxRequests,
    maxQueriesPerRequest: defaults.maxQueriesPerRequest,
    maxShapes: defaults.maxShapes,
    maxRoutes: defaults.maxRoutes,
    maxErrorGroups: defaults.maxErrorGroups,
    requestRetentionHours: defaults.requestRetentionHours,
    maxStoredSamplesPerMinute: defaults.maxStoredSamplesPerMinute,
    reportIntervalMs: defaults.reportIntervalMs,
    trustedProxies: [],
    requireHttps: true,
    allowedIps: [],
    origin: null,
    session: { ...defaults.session },
    twoFactor: "admins",
    rateLimits: { ...defaults.rateLimits },
    explain: { executing: false },
    panels: {},
    logLevels: ["warn", "error"],
    auditRetentionDays: defaults.auditRetentionDays,
    passkeys: { rpName: "Warlock monitor", rpId: null },
    ...overrides,
  };
}

export const SECRET = "s3cr3t-v4lue-9f2a";

/** A fake clock and a scripted random source. */
export function createClock(start = 1_700_000_000_000) {
  let current = start;

  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

export function createEngine(
  overrides: {
    production?: Partial<ResolvedDevtoolsProductionOptions>;
    store?: DevtoolsCaptureDeps["store"];
    random?: () => number;
    now?: () => number;
    warn?: (message: string) => void;
    run?: DevtoolsCaptureDeps["run"];
  } = {},
) {
  const store = overrides.store === undefined ? createMemoryStore() : overrides.store;
  const clock = createClock();
  const warnings: string[] = [];
  const engine = createCaptureEngine({
    options: { path: "/ops-secret-path", maxRequests: 200, nPlusOneThreshold: 5 },
    production: productionOptions(overrides.production),
    instance,
    store,
    isDashboardPath: (path) => path.startsWith("/ops-secret-path"),
    random: overrides.random ?? (() => 0),
    now: overrides.now ?? clock.now,
    warn: overrides.warn ?? ((message) => warnings.push(message)),
    ...(overrides.run === undefined ? {} : { run: overrides.run }),
  });

  return { engine, store, clock, warnings };
}

export type TestEngine = ReturnType<typeof createEngine>["engine"];

export function traced(id: string, path = "/posts/1", route: string | undefined = "/posts/:id") {
  return { requestId: id, method: "GET", path, ...(route === undefined ? {} : { route }) };
}

export function queryEvent(overrides: Partial<DevtoolsQueryEvent> = {}): DevtoolsQueryEvent {
  return {
    connection: "default",
    driver: "postgres",
    sql: "SELECT * FROM posts WHERE id = $1",
    bindings: [1],
    durationMs: 3,
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Starts, feeds and ends one request through the hooks. */
export function runRequest(
  engine: TestEngine,
  id: string,
  options: {
    path?: string;
    route?: string | undefined;
    status?: number;
    durationMs?: number;
    error?: unknown;
    queries?: Partial<DevtoolsQueryEvent>[];
    phases?: { name: string; durationMs: number }[];
  } = {},
) {
  const request = traced(
    id,
    options.path ?? "/posts/1",
    "route" in options ? options.route : "/posts/:id",
  );

  engine.hooks.onRequestStart(request);

  for (const phase of options.phases ?? []) engine.hooks.onPhase(request, phase);
  for (const query of options.queries ?? []) engine.hooks.onQuery(id, queryEvent(query));

  engine.hooks.onRequestEnd(request, {
    status: options.status ?? 200,
    durationMs: options.durationMs ?? 12,
    ...(options.error === undefined ? {} : { error: options.error }),
  });
}
