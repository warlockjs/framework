/**
 * Throughput of a real Fastify server with the production capture off and on.
 *
 * "Off" runs the same server hooks with no-op functions, so the figures show
 * what the capture itself costs.
 *
 * Each request runs 3 phases, 5 queries and 1 log line, delivered to the
 * capture's hooks the way the tracing, query and log sources deliver them.
 * 16 concurrent keep-alive clients send 20 000 requests; each configuration
 * runs 3 times, alternating, and the median requests per second is printed.
 *
 * `SAMPLE_RATE=<0-1>` overrides the default sample rate (0.1).
 *
 * Run it through the heavy-run wrapper:
 *
 *   /root/.claude/bin/heavy-run node --import tsx bench/production-overhead.ts
 */
import Fastify from "fastify";
import { Agent, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { cpus } from "node:os";
import { createCaptureEngine, type DevtoolsCaptureHooks } from "../src/production/capture/engine";
import { DEVTOOLS_PRODUCTION_DEFAULTS } from "../src/production/options";
import { createMemoryStore } from "../src/production/store/memory-store";

const TOTAL_REQUESTS = 20_000;
const CONCURRENCY = 16;
const RUNS = 3;

const production = {
  path: "/ops-bench-path",
  admin: { email: null, password: null, setupToken: null },
  sampleRate: Number(process.env.SAMPLE_RATE ?? DEVTOOLS_PRODUCTION_DEFAULTS.sampleRate),
  slowRequestMs: DEVTOOLS_PRODUCTION_DEFAULTS.slowRequestMs,
  slowQueryMs: DEVTOOLS_PRODUCTION_DEFAULTS.slowQueryMs,
  maxRequests: DEVTOOLS_PRODUCTION_DEFAULTS.maxRequests,
  maxQueriesPerRequest: DEVTOOLS_PRODUCTION_DEFAULTS.maxQueriesPerRequest,
  maxShapes: DEVTOOLS_PRODUCTION_DEFAULTS.maxShapes,
  maxRoutes: DEVTOOLS_PRODUCTION_DEFAULTS.maxRoutes,
  maxErrorGroups: DEVTOOLS_PRODUCTION_DEFAULTS.maxErrorGroups,
  requestRetentionHours: DEVTOOLS_PRODUCTION_DEFAULTS.requestRetentionHours,
  maxStoredSamplesPerMinute: DEVTOOLS_PRODUCTION_DEFAULTS.maxStoredSamplesPerMinute,
  reportIntervalMs: DEVTOOLS_PRODUCTION_DEFAULTS.reportIntervalMs,
  trustedProxies: [],
  requireHttps: true,
  allowedIps: [],
  origin: null,
  session: { ...DEVTOOLS_PRODUCTION_DEFAULTS.session },
  twoFactor: "admins" as const,
  rateLimits: { ...DEVTOOLS_PRODUCTION_DEFAULTS.rateLimits },
  explain: { executing: false },
  panels: {},
  logLevels: ["warn", "error"] as ("warn" | "error")[],
  auditRetentionDays: DEVTOOLS_PRODUCTION_DEFAULTS.auditRetentionDays,
  passkeys: { rpName: "Warlock monitor", rpId: null },
};

const instance = {
  id: "bench:1:0",
  label: "bench",
  host: "bench",
  pid: process.pid,
  worker: null,
  startedAt: Date.now(),
  seenAt: Date.now(),
  nodeVersion: process.version,
};

/** A body of about 1 KB, the size of a small JSON API answer. */
const body = {
  id: 42,
  title: "A post about monitors",
  tags: ["a", "b", "c", "d"],
  author: { id: 7, name: "Ann", email: "ann@example.com" },
  comments: Array.from({ length: 6 }, (_, index) => ({
    id: index,
    text: "A comment with some words in it",
    likes: index * 3,
  })),
};

/** "Off" runs the same server hooks with no-op functions, so only the capture itself differs. */
const noop = () => {};
const noopHooks: DevtoolsCaptureHooks = {
  onRequestStart: noop,
  onPhase: noop,
  onRequestEnd: noop,
  onQuery: noop,
  onLog: noop,
  onCache: noop,
};

async function startServer(hooks: DevtoolsCaptureHooks) {
  const app = Fastify({ logger: false });
  let counter = 0;

  {
    app.addHook("onRequest", async (req) => {
      const traced = {
        requestId: String(req.id),
        method: req.method,
        path: req.url,
        route: "/posts/:id",
      };

      (req as unknown as { traced: typeof traced }).traced = traced;
      hooks.onRequestStart(traced);
    });
    app.addHook("onResponse", async (req, reply) => {
      const traced = (
        req as unknown as { traced: { requestId: string; method: string; path: string } }
      ).traced;

      hooks.onRequestEnd(traced, { status: reply.statusCode, durationMs: reply.elapsedTime });
    });
  }

  app.get("/posts/:id", async (req) => {
    const traced = (
      req as unknown as { traced?: { requestId: string; method: string; path: string } }
    ).traced;
    const id = String(req.id);

    if (traced) {
      for (const name of ["middleware", "validation", "handler"]) {
        hooks.onPhase(traced, { name, durationMs: 1, startedAt: performance.now() });
      }
    }

    for (let query = 0; query < 5; query++) {
      // Stands in for waiting on the database.
      await new Promise<void>((resolve) => setImmediate(resolve));

      hooks.onQuery(id, {
        connection: "default",
        driver: "postgres",
        sql: `SELECT * FROM table_${query} WHERE id = $1`,
        bindings: [++counter],
        durationMs: 1,
        startedAt: performance.now(),
      });
    }

    hooks.onLog(id, {
      level: "info",
      module: "app",
      action: "seen",
      message: "handled",
      at: Date.now(),
    });

    return body;
  });

  await app.listen({ port: 0, host: "127.0.0.1" });

  return { app, port: (app.server.address() as AddressInfo).port };
}

async function load(port: number): Promise<number> {
  const agent = new Agent({ keepAlive: true, maxSockets: CONCURRENCY });
  let sent = 0;

  const worker = async () => {
    while (sent < TOTAL_REQUESTS) {
      sent++;
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path: "/posts/42", agent }, (res) => {
          res.resume();
          res.on("end", resolve);
        });

        req.on("error", reject);
        req.end();
      });
    }
  };

  const started = performance.now();

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const seconds = (performance.now() - started) / 1000;

  agent.destroy();

  return TOTAL_REQUESTS / seconds;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] as number;
}

async function measure(withCapture: boolean): Promise<number> {
  const engine = withCapture
    ? createCaptureEngine({
        options: {
          path: production.path,
          maxRequests: production.maxRequests,
          nPlusOneThreshold: 5,
        },
        production,
        instance,
        store: process.env.STORE === "none" ? null : createMemoryStore(),
        isDashboardPath: (path) => path.startsWith(production.path),
        warn: () => {},
      })
    : null;

  engine?.startWriter();

  const { app, port } = await startServer(engine ? engine.hooks : noopHooks);

  try {
    await load(port); // warm up

    return await load(port);
  } finally {
    engine?.stopWriter();
    await engine?.flush();
    await app.close();
  }
}

const off: number[] = [];
const on: number[] = [];

for (let run = 0; run < RUNS; run++) {
  off.push(await measure(false));
  on.push(await measure(true));
}

const offMedian = median(off);
const onMedian = median(on);
const loss = ((offMedian - onMedian) / offMedian) * 100;

console.info(
  [
    `machine: ${cpus()[0]?.model ?? "unknown"} x${cpus().length}, node ${process.version}`,
    `${TOTAL_REQUESTS} requests, ${CONCURRENCY} keep-alive clients, 3 phases + 5 queries + 1 log per request, sampleRate ${production.sampleRate}`,
    `off: ${off.map((value) => value.toFixed(0)).join(", ")} req/s (median ${offMedian.toFixed(0)})`,
    `on:  ${on.map((value) => value.toFixed(0)).join(", ")} req/s (median ${onMedian.toFixed(0)})`,
    `throughput loss: ${loss.toFixed(1)} %`,
  ].join("\n"),
);
