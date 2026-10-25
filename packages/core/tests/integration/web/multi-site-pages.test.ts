import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AppFixture } from "../../../src/e2e/fixture";
import type { E2EEvidence } from "../../../src/e2e/types";
import { NAMED_ROUTE, SITE_HOSTS, workspace, writeTwoSiteApp } from "./two-site-app";

/**
 * The multi-site development regression: in an app with `web.sites`, every page
 * answered 500 in `warlock dev` and under the HTTP test server (the site
 * registration facade had no named-route registry), while production was fine.
 *
 * One two-site fixture app (`landing` and `client`, each page names a route
 * with `apiHref`), rendered on both sites in both modes.
 */

const require = createRequire(import.meta.url);
const temporaryDirectories: string[] = [];

afterAll(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function makeApp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "warlock-two-site-"));

  temporaryDirectories.push(directory);
  await writeTwoSiteApp(directory);

  return directory;
}

/** A GET with an explicit `Host` header, which `fetch` does not promise to send. */
function get(url: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "GET",
        headers: { host, accept: "text/html" },
      },
      (incoming) => {
        let body = "";

        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => (body += chunk));
        incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body }));
      },
    );

    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("two-site app", () => {
  it("renders each site's root page in development", async () => {
    const source = await makeApp();
    const evidence: E2EEvidence = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      status: "running",
      steps: [],
      console: [],
      networkFailures: [],
      screenshots: [],
      processes: [],
      errors: [],
    };
    const fixture = await AppFixture.create(evidence);

    try {
      const context = await fixture.start(
        {
          directory: source,
          start: [process.execPath, join(workspace, "packages/core/bin/warlock.js"), "dev"],
          env: { NODE_ENV: "development", WARLOCK_DEV_WORKER: "1" },
          // The health route answers on any host; the sites answer only on theirs.
          readyPath: "/health",
          startupTimeoutMs: 180_000,
        },
        {},
      );

      for (const [site, host] of Object.entries(SITE_HOSTS)) {
        const response = await get(context.url, host);

        expect(response.status, `${site} (${host}): ${response.body.slice(0, 2000)}`).toBe(200);
        expect(response.body).toContain(`${site} home`);
        expect(response.body).toContain(NAMED_ROUTE);
      }
    } finally {
      await fixture.stop();
    }
  }, 240_000);

  it("renders each site's root page under the HTTP test server", async () => {
    const source = await makeApp();
    const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
    );

    const run = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [vitest, "run", "--reporter=default"], {
        cwd: source,
        env: { ...environment, NODE_ENV: "test" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);

      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });

    expect(run.output).toContain("2 passed");
    expect(run.code, run.output.slice(-4000)).toBe(0);
  }, 240_000);
});
