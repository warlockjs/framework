import config from "@mongez/config";
import { createServer } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { container } from "../container";
import { SocketConnector } from "./socket-connector";

vi.mock("@warlock.js/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

// Mimics engine.io's attach: lifts the request listeners into a wrapper and
// adds upgrade/close/listening listeners.
vi.mock("socket.io", () => ({
  Server: class {
    engine = { close: vi.fn() };
    constructor(server: any) {
      const existing = server.listeners("request").slice();
      server.removeAllListeners("request");
      server.on("request", (...args: any[]) => existing.forEach((l: any) => l(...args)));
      server.on("upgrade", () => {});
      server.on("close", () => {});
      server.on("listening", () => {});
    }
    adapter = vi.fn();
    of = () => ({ disconnectSockets: vi.fn() });
  },
}));

const events = ["request", "upgrade", "close", "listening"];

describe("SocketConnector shared-server listeners", () => {
  afterEach(() => vi.restoreAllMocks());

  it("leaves the server's listener counts unchanged after repeated attach/detach", async () => {
    const server = createServer();
    const fastifyHandler = () => {};
    server.on("request", fastifyHandler);
    const counts = () => events.map(event => server.listenerCount(event));
    const initial = counts();

    vi.spyOn(config, "get").mockReturnValue({} as never);
    vi.spyOn(container, "tryGet").mockImplementation(((key: string) =>
      key === "http.server" ? { server } : (connector as any).socket) as never);
    vi.spyOn(container, "set").mockImplementation((() => {}) as never);

    const connector = new SocketConnector() as any;

    for (let i = 0; i < 3; i++) {
      await connector.boot();
      await connector.start();
      expect(counts()).not.toEqual(initial);
      await connector.shutdown();
      expect(counts()).toEqual(initial);
    }

    expect(server.listeners("request")).toEqual([fastifyHandler]);
  });
});
