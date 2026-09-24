import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectRouteRegistrationSnapshot,
  type RouteRegistrationChildProcess,
} from "./route-registration-snapshot";

class FakeChild extends EventEmitter {
  public connected = true;
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public readonly send = vi.fn();
  public readonly kill = vi.fn();
  public readonly disconnect = vi.fn(() => {
    this.connected = false;
  });
}

describe("collectRouteRegistrationSnapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses IPC rather than stdout and disconnects its child after a valid snapshot", async () => {
    const child = new FakeChild();
    const result = collectRouteRegistrationSnapshot({
      cwd: "C:/app",
      forkProcess: () => child as unknown as RouteRegistrationChildProcess,
    });

    child.stdout.emit("data", Buffer.from("application bootstrap log"));
    child.emit("message", {
      type: "route-registration:snapshot",
      snapshot: { version: 1, routes: [{ name: "users.create", path: "/users", method: "POST" }] },
    });
    child.emit("close", 0);

    await expect(result).resolves.toEqual({
      version: 1,
      routes: [{ name: "users.create", path: "/users", method: "POST" }],
    });
    expect(child.send).toHaveBeenCalledWith(expect.objectContaining({ version: 1, cwd: "C:/app" }));
    expect(child.disconnect).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("rejects malformed protocol records, cleans up its child, and never accepts unsafe fields", async () => {
    const child = new FakeChild();
    const result = collectRouteRegistrationSnapshot({
      forkProcess: () => child as unknown as RouteRegistrationChildProcess,
    });

    child.emit("message", {
      type: "route-registration:snapshot",
      snapshot: {
        version: 1,
        routes: [{ name: "users.create", path: "/users", method: "POST", handler: "unsafe" }],
      },
    });

    await expect(result).rejects.toThrow("non-browser-safe fields");
    expect(child.disconnect).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("rejects an explicit child import failure instead of returning a stale snapshot", async () => {
    const child = new FakeChild();
    const result = collectRouteRegistrationSnapshot({
      forkProcess: () => child as unknown as RouteRegistrationChildProcess,
    });

    child.emit("message", { type: "route-registration:error", message: "route import failed" });

    await expect(result).rejects.toThrow("route import failed");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("keeps the registration child free of framework connector lifecycle calls", async () => {
    const source = await readFile(
      fileURLToPath(new URL("./route-registration-child.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("filesOrchestrator.moduleLoader.loadAll()");
    expect(source).not.toMatch(
      /registerConfiguredConnectors|connectorsManager|startDevelopmentServer|runStartupValidators|markBooted|watchFiles|checkHealth/,
    );
  });
});
