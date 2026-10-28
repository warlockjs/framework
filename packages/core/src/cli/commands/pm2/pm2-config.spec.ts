import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPm2Config,
  pm2AppName,
  selectPm2Targets,
  writePm2Config,
  type Pm2AppInput,
} from "./pm2-config";

const input: Pm2AppInput = {
  root: path.resolve("/srv/store"),
  project: "@example/store",
  app: { appName: "api" },
  environment: "production",
  entryPath: path.resolve("/srv/store", "output/server.mjs"),
  sourcemap: true,
  http: { host: "0.0.0.0", port: 8080 },
};

function worker(id: number, overrides: Record<string, unknown> = {}) {
  return {
    pm_id: id,
    name: "example-store-api-production",
    pm2_env: {
      pm_cwd: input.root,
      pm_exec_path: input.entryPath,
      exec_mode: "cluster_mode",
      wait_ready: true,
      status: "online",
      ...overrides,
    },
  };
}

describe("PM2 config generation", () => {
  it("derives identity, bundle, readiness and shutdown budget without starting PM2", () => {
    const generated = createPm2Config(input);
    expect(generated.app).toEqual({
      name: "example-store-api-production",
      cwd: input.root,
      script: input.entryPath,
      interpreter: process.execPath,
      node_args: ["--enable-source-maps"],
      exec_mode: "fork",
      instances: 1,
      wait_ready: true,
      listen_timeout: 30_000,
      kill_timeout: 10_000,
      time: false,
      merge_logs: false,
      env: { NODE_ENV: "production" },
    });
    expect(generated.readinessUrl).toBe("http://127.0.0.1:8080/ready");
    expect(generated.content).toContain("module.exports = ");
    expect(generated.content).toContain('"NODE_ENV": "production"');
    expect(generated.content).not.toContain("warlock start");
  });

  it("uses app shutdown timeout, cluster options, custom probes and disabled source maps", () => {
    const generated = createPm2Config(
      {
        ...input,
        app: { appName: "api", shutdownTimeout: 25_000 },
        sourcemap: false,
        http: {
          host: "::",
          port: 8443,
          serverOptions: { https: {} },
          health: { readinessPath: "/status/ready" },
        },
      },
      { cluster: true, instances: "3", listenTimeout: "60000" },
    );
    expect(generated.app).toMatchObject({
      exec_mode: "cluster",
      instances: 3,
      kill_timeout: 25_000,
      listen_timeout: 60_000,
      node_args: [],
    });
    expect(generated.readinessUrl).toBe("https://[::1]:8443/status/ready");
  });

  it("supports an explicit max worker count and conservative cluster defaults", () => {
    expect(createPm2Config(input, { cluster: true }).app.instances).toBe(2);
    expect(createPm2Config(input, { cluster: true, instances: "max" }).app.instances).toBe("max");
  });

  it("does not advertise a nonexistent health endpoint", () => {
    expect(createPm2Config({ ...input, http: undefined }).readinessUrl).toBeUndefined();
    expect(
      createPm2Config({ ...input, http: { health: { enabled: false } } }).readinessUrl,
    ).toBeUndefined();
    expect(createPm2Config({ ...input, http: { port: 0 } }).readinessUrl).toBeUndefined();
  });

  it("keeps environments and app names distinct", () => {
    expect(pm2AppName({ ...input, environment: "staging" })).toBe("example-store-api-staging");
    expect(pm2AppName({ ...input, app: {} })).toBe("example-store-app-production");
  });

  it.each(["/api.*/", "api,worker", "--all", "api app", "../api", ""])(
    "refuses unsafe app identity %j",
    (appName) => {
      expect(() => createPm2Config({ ...input, app: { appName } })).toThrow("App name");
    },
  );

  it.each(["0", "-1", "1.5", "NaN", "1e3", "2147483648"])(
    "refuses invalid readiness timeout %j",
    (listenTimeout) => {
      expect(() => createPm2Config(input, { listenTimeout })).toThrow("--listen-timeout");
    },
  );

  it("refuses invalid budgets, instance counts and fork scaling", () => {
    expect(() => createPm2Config({ ...input, app: { shutdownTimeout: -1 } })).toThrow(
      "app.shutdownTimeout",
    );
    expect(() => createPm2Config(input, { cluster: true, instances: "0" })).toThrow("--instances");
    expect(() => createPm2Config(input, { instances: "2" })).toThrow(
      "--instances requires --cluster",
    );
  });

  it("refuses cluster sockets without an adapter even if the single-server warning is silenced", () => {
    expect(() =>
      createPm2Config(
        { ...input, socket: { silenceSingleServerWarning: true } },
        { cluster: true },
      ),
    ).toThrow("socket.adapter");
    expect(() => createPm2Config({ ...input, socket: {} })).not.toThrow();
  });

  it("refuses polling behind a shared cluster listener even with an adapter", () => {
    expect(() =>
      createPm2Config({ ...input, socket: { adapter: () => class Adapter {} } }, { cluster: true }),
    ).toThrow("sticky routing");
    expect(() =>
      createPm2Config(
        {
          ...input,
          socket: { adapter: () => class Adapter {}, options: { transports: ["websocket"] } },
        },
        { cluster: true },
      ),
    ).not.toThrow();
  });
});

describe("ecosystem file creation", () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("writes CommonJS once and refuses to overwrite a customized file", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "warlock-pm2-"));
    const generated = createPm2Config(input);
    const target = await writePm2Config(directory, generated.content);
    expect(path.basename(target)).toBe("ecosystem.config.cjs");
    expect(await readFile(target, "utf8")).toBe(generated.content);
    await expect(writePm2Config(directory, "replacement")).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(target, "utf8")).toBe(generated.content);
  });
});

describe("PM2 reload selection", () => {
  it("selects only exact names and supports id zero", () => {
    const other = { ...worker(9), name: "example-store-api-production-other" };
    expect(selectPm2Targets([other, worker(0), worker(2)], input)).toEqual([
      { id: 0, cluster: true },
      { id: 2, cluster: true },
    ]);
    expect(selectPm2Targets([worker(0), worker(2)], input, "0")).toEqual([
      { id: 0, cluster: true },
    ]);
  });

  it("validates every matching worker before any reload can occur", () => {
    expect(() => selectPm2Targets([worker(0), worker(1, { pm_cwd: "/srv/other" })], input)).toThrow(
      "does not belong",
    );
    expect(() =>
      selectPm2Targets([worker(0, { pm_exec_path: "/srv/other/server.mjs" })], input),
    ).toThrow("does not belong");
    expect(() => selectPm2Targets([{ ...worker(0), name: "other-app" }], input, "0")).toThrow(
      "does not belong",
    );
  });

  it.each(["all", "/api/", "-1", "1,2", "0.5"])("rejects non-id selector %j", (id) => {
    expect(() => selectPm2Targets([worker(0)], input, id)).toThrow("numeric PM2 id");
  });

  it("refuses missing, malformed, duplicate, unready and unrecognized targets", () => {
    expect(() => selectPm2Targets([], input)).toThrow("No PM2 process");
    expect(() => selectPm2Targets({}, input)).toThrow("process array");
    expect(() => selectPm2Targets([worker(0), worker(0)], input)).toThrow("Duplicate");
    expect(() => selectPm2Targets([worker(0, { wait_ready: false })], input)).toThrow("wait_ready");
    expect(() => selectPm2Targets([worker(0, { status: "stopped" })], input)).toThrow("online");
    expect(() => selectPm2Targets([worker(0, { exec_mode: "unknown" })], input)).toThrow(
      "execution mode",
    );
  });

  it("checks cluster socket safety on reload too and identifies fork restarts", () => {
    expect(() => selectPm2Targets([worker(0)], { ...input, socket: {} })).toThrow("socket.adapter");
    expect(selectPm2Targets([worker(0, { exec_mode: "fork_mode" })], input)).toEqual([
      { id: 0, cluster: false },
    ]);
  });
});
