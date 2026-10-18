import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  root: "",
  app: { appName: "api" },
  list: "[]",
  ready: true,
  execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: state.execFile }));
vi.mock("../../../config/config-getter", () => ({
  config: {
    get: (key: string) => (key === "app" ? state.app : key === "http" ? { port: 8080 } : undefined),
  },
}));
vi.mock("../../../production/resolve-build-config", () => ({
  resolveBuildConfig: () => ({
    outdir: path.join(state.root, "dist"),
    entryPath: path.join(state.root, "dist/app.js"),
    sourcemap: true,
  }),
}));
vi.mock("../../../production/assert-dist-ready-to-start", () => ({
  checkDistReadyToStartAsync: async () =>
    state.ready ? { ready: true } : { ready: false, reason: "No build-success marker" },
}));

import { pm2Command } from "../pm2.command";
import { pm2CommandAction } from "./pm2-command.action";

function worker(id: number, root = state.root, execMode = "cluster_mode") {
  return {
    name: "store-api-production",
    pm_id: id,
    pm2_env: {
      pm_cwd: root,
      pm_exec_path: path.join(root, "dist/app.js"),
      exec_mode: execMode,
      wait_ready: true,
      status: "online",
    },
  };
}

beforeEach(async () => {
  state.root = await mkdtemp(path.join(tmpdir(), "warlock-pm2-cli-"));
  state.ready = true;
  state.list = "[]";
  state.execFile.mockReset();
  // Stand in for every PM2 child. No daemon or real process is launched.
  state.execFile.mockImplementation(
    (
      _file: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      queueMicrotask(() => callback(null, args[0] === "jlist" ? state.list : ""));
      return { pid: 12345 };
    },
  );
  await writeFile(path.join(state.root, "package.json"), JSON.stringify({ name: "store" }));
  vi.spyOn(process, "cwd").mockReturnValue(state.root);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(state.root, { recursive: true, force: true });
});

describe("warlock pm2", () => {
  it("registers a config-only command without bootstrap or connectors", () => {
    expect(pm2Command.name).toBe("pm2 <action>");
    expect(pm2Command.commandPreload).toEqual({
      warlockConfig: true,
      config: ["app", "http", "socket"],
    });
  });

  it("initializes from app/build config with no installed PM2 and no prior build", async () => {
    state.ready = false;
    await pm2CommandAction({ args: ["init"], options: {} });
    const content = await readFile(path.join(state.root, "ecosystem.config.cjs"), "utf8");
    expect(content).toContain('"name": "store-api-production"');
    expect(content).toContain(JSON.stringify(path.join(state.root, "dist/app.js")));
    expect(state.execFile).not.toHaveBeenCalled();
  });

  it("reloads matched workers sequentially by numeric ids only", async () => {
    state.list = JSON.stringify([worker(0), worker(2), { ...worker(9), name: "other-app" }]);
    await pm2CommandAction({ args: ["reload"], options: {} });
    expect(state.execFile.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["pm2", ["jlist"]],
      ["pm2", ["reload", "0"]],
      ["pm2", ["reload", "2"]],
    ]);
    expect(state.execFile.mock.calls[0]?.[2]).toMatchObject({ cwd: state.root, encoding: "utf8" });
  });

  it("supports a single verified PM2 id", async () => {
    state.list = JSON.stringify([worker(0), worker(2)]);
    await pm2CommandAction({ args: ["reload"], options: { id: "2" } });
    expect(state.execFile.mock.calls.map((call) => call[1])).toEqual([["jlist"], ["reload", "2"]]);
  });

  it("refuses an identity collision without reloading even the earlier valid match", async () => {
    state.list = JSON.stringify([worker(0), worker(2, "/srv/other")]);
    await expect(pm2CommandAction({ args: ["reload"], options: {} })).rejects.toThrow(
      "does not belong",
    );
    expect(state.execFile).toHaveBeenCalledTimes(1);
  });

  it("refuses a foreign explicit id and malformed PM2 output", async () => {
    state.list = JSON.stringify([{ ...worker(0), name: "other-app" }]);
    await expect(pm2CommandAction({ args: ["reload"], options: { id: "0" } })).rejects.toThrow(
      "does not belong",
    );
    state.list = "not JSON";
    await expect(pm2CommandAction({ args: ["reload"], options: {} })).rejects.toThrow();
    expect(state.execFile.mock.calls.every((call) => call[1][0] === "jlist")).toBe(true);
  });

  it("refuses a failed build before contacting PM2", async () => {
    state.ready = false;
    await expect(pm2CommandAction({ args: ["reload"], options: {} })).rejects.toThrow(
      "build-success marker",
    );
    expect(state.execFile).not.toHaveBeenCalled();
  });

  it("warns that fork reload is a restart", async () => {
    state.list = JSON.stringify([worker(0, state.root, "fork_mode")]);
    await pm2CommandAction({ args: ["reload"], options: {} });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("brief interruption"));
  });

  it("reports a missing optional executable", async () => {
    state.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error, stdout: string) => void,
      ) => {
        queueMicrotask(() => callback(new Error("ENOENT"), ""));
        return { pid: undefined };
      },
    );
    await expect(pm2CommandAction({ args: ["reload"], options: {} })).rejects.toThrow(
      "Install PM2 separately",
    );
    expect(state.execFile).toHaveBeenCalledTimes(1);
  });

  it("stops the sequence after a reload failure", async () => {
    state.list = JSON.stringify([worker(0), worker(2)]);
    state.execFile.mockImplementation(
      (
        _file: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        queueMicrotask(() =>
          callback(
            args[0] === "reload" ? new Error("reload failed") : null,
            args[0] === "jlist" ? state.list : "",
          ),
        );
        return { pid: 12345 };
      },
    );
    await expect(pm2CommandAction({ args: ["reload"], options: {} })).rejects.toThrow(
      "reload failed",
    );
    expect(state.execFile.mock.calls.map((call) => call[1])).toEqual([["jlist"], ["reload", "0"]]);
  });

  it("rejects unknown actions and options without contacting PM2", async () => {
    await expect(pm2CommandAction({ args: ["stop"], options: {} })).rejects.toThrow("Usage:");
    await expect(pm2CommandAction({ args: ["reload", "all"], options: {} })).rejects.toThrow(
      "Usage:",
    );
    await expect(
      pm2CommandAction({ args: ["reload"], options: { cluster: true } }),
    ).rejects.toThrow("Unsupported option");
    expect(state.execFile).not.toHaveBeenCalled();
  });
});
