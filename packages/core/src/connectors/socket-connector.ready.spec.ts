import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listen: vi.fn(),
  adapter: vi.fn(),
  server: undefined as EventEmitter | undefined,
  logError: vi.fn(),
}));
vi.mock("http", () => ({ createServer: () => state.server }));
vi.mock("@mongez/config", () => ({ default: { get: () => ({ port: 8080 }) } }));
vi.mock("@warlock.js/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: state.logError },
}));
vi.mock("../container", () => ({ container: { tryGet: () => undefined, set: vi.fn() } }));
vi.mock("../utils/environment", () => ({ environment: () => "test" }));
vi.mock("socket.io", () => ({
  Server: class {
    adapter = state.adapter;
  },
}));

import { SocketConnector } from "./socket-connector";

beforeEach(() => {
  vi.clearAllMocks();
  state.server = Object.assign(new EventEmitter(), { listen: state.listen });
});
afterEach(() => {
  state.server?.removeAllListeners();
});

describe("socket-only boot readiness", () => {
  it("does not complete connector boot before its listener is bound", async () => {
    let listening: (() => void) | undefined;
    state.listen.mockImplementation((_port: number, callback: () => void) => {
      listening = callback;
    });
    const connector = new SocketConnector();
    let booted = false;
    const boot = connector.boot().then(() => {
      booted = true;
    });
    // Dynamic socket.io import completes on a later microtask; wait for the
    // fake listen call, never for a real socket or process.
    await vi.waitFor(() => expect(state.listen).toHaveBeenCalledOnce());
    expect(booted).toBe(false);
    expect(state.listen).toHaveBeenCalledWith(8080, expect.any(Function));
    listening?.();
    await boot;
    expect(booted).toBe(true);
  });

  it("rejects a failed bind so the late phase cannot announce readiness", async () => {
    state.listen.mockImplementation(() => {
      queueMicrotask(() => state.server?.emit("error", new Error("EADDRINUSE")));
    });
    await expect(new SocketConnector().boot()).rejects.toThrow("EADDRINUSE");
    expect(state.logError).toHaveBeenCalled();
  });
});
