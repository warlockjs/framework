import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CdpConnection } from "./cdp";
import { fakeCdp } from "./fake-cdp.test-support";

const holder = vi.hoisted(() => ({ endpoint: "", closed: false }));
vi.mock("./browser", () => ({
  OwnedBrowser: class {
    private connection?: CdpConnection;
    async start() {
      this.connection = await CdpConnection.connect(holder.endpoint);
      return this.connection;
    }
    async stop() {
      this.connection?.close();
      holder.closed = true;
    }
  },
}));
import { E2ERunError, runE2E } from "./run-e2e";
import type { E2EEvidence } from "./types";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  holder.closed = false;
  let width = 1280;
  const endpoint = await fakeCdp(({ method, params }) => {
    if (method === "Emulation.setDeviceMetricsOverride") width = Number(params.width);
    if (method === "Runtime.evaluate") {
      const expression = String(params.expression);
      return {
        result: {
          result: {
            value: expression.includes("requestedWidth:")
              ? {
                  requestedWidth: width,
                  innerWidth: width,
                  documentWidth: width,
                  bodyWidth: width,
                  offenders: [],
                }
              : true,
          },
        },
      };
    }
    if (method === "Page.captureScreenshot")
      return { result: { data: Buffer.from("fake png").toString("base64") } };
    return { result: {} };
  });
  cleanups.push(endpoint.close);
  holder.endpoint = endpoint.url;
  const source = await mkdtemp(join(tmpdir(), "warlock-run-spec-"));
  cleanups.push(() => rm(source, { recursive: true, force: true }));
  await writeFile(
    join(source, "app.mjs"),
    `import{createServer}from'node:http';import{writeFileSync}from'node:fs';const s=createServer((q,r)=>r.end('ready'));s.listen(0,'127.0.0.1',()=>writeFileSync(process.env.WARLOCK_E2E_PORT_FILE,String(s.address().port)));`,
  );
  return {
    endpoint,
    source,
    app: { directory: source, portFromFile: true, start: [process.execPath, "app.mjs"] as const },
    options: { outputDirectory: join(source, "evidence") },
  };
}

describe("browser run evidence against a fake CDP endpoint", () => {
  it("preserves a spec failure, captures both widths and stops the app before reporting", async () => {
    const { app, options } = await setup();
    let dataRoot = "";
    const failure = await runE2E(
      {
        app,
        run: async (context) => {
          dataRoot = context.dataRoot;
          await context.step("deliberate failure", async () => {
            throw new Error("original spec failure");
          });
        },
      },
      options,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(E2ERunError);
    if (!(failure instanceof E2ERunError)) throw new Error("Expected e2e run error");
    const persisted = JSON.parse(
      await readFile(failure.result.evidenceFile, "utf8"),
    ) as E2EEvidence;
    expect(persisted.errors).toContain("original spec failure");
    expect(persisted.steps[1]).toMatchObject({ name: "deliberate failure", status: "failed" });
    expect(persisted.screenshots.map(({ viewport }) => viewport.width)).toEqual([1280, 390]);
    expect(persisted.processes.every(({ stopped }) => stopped)).toBe(true);
    expect(holder.closed).toBe(true);
    await expect(access(dataRoot)).rejects.toThrow();
  });

  it("writes startup failure evidence and stops owned groups before any browser starts", async () => {
    const { app, options } = await setup();
    const failure = await runE2E(
      { app: { ...app, build: [process.execPath, "-e", "process.exit(9)"] }, run: async () => {} },
      options,
    ).catch((error: unknown) => error);
    if (!(failure instanceof E2ERunError)) throw new Error("Expected e2e startup error");
    expect(failure.result.evidence.errors.join("\n")).toContain("build failed");
    expect(failure.result.evidence.processes[0].stopped).toBe(true);
    expect(failure.result.evidence.screenshots).toEqual([]);
    expect(holder.closed).toBe(false);
  });

  it("aborts a pending spec and still writes evidence after teardown", async () => {
    const { app, options } = await setup();
    const abort = new AbortController();
    const failure = await runE2E(
      {
        app,
        run: async () => {
          abort.abort(new Error("caller canceled"));
          await new Promise<void>(() => {});
        },
      },
      { ...options, signal: abort.signal },
    ).catch((error: unknown) => error);
    if (!(failure instanceof E2ERunError)) throw new Error("Expected e2e cancellation error");
    expect(failure.result.evidence.errors).toContain("caller canceled");
    expect(failure.result.evidence.processes.every(({ stopped }) => stopped)).toBe(true);
    expect(holder.closed).toBe(true);
  });
});
