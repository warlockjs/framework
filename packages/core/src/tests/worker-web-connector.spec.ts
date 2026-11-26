import { afterEach, describe, expect, it, vi } from "vitest";
import { container } from "../container";
import type { Connector } from "../connectors/types";
import type { FastifyInstance } from "../http/server";
import { startWebConnectorOn } from "./worker-web-connector";

function fakeWeb(active = false) {
  const calls: string[] = [];
  const connector = {
    name: "web",
    isActive: () => active,
    boot: vi.fn(async () => void calls.push("boot")),
    start: vi.fn(async () => void calls.push("start")),
    shutdown: vi.fn(async () => void calls.push("shutdown")),
  } as unknown as Connector;

  return { connector, calls };
}

const server = { marker: "worker server" } as unknown as FastifyInstance;

afterEach(() => {
  container.delete("http.server");
});

describe("web connector in a worker's test server", () => {
  it("publishes the server, boots then starts the connector, and returns its stop", async () => {
    const { connector, calls } = fakeWeb();
    const stop = await startWebConnectorOn(server, connector);

    expect(container.get("http.server")).toBe(server);
    expect(calls).toEqual(["boot", "start"]);

    await stop?.();

    expect(calls).toEqual(["boot", "start", "shutdown"]);
  });

  it("does nothing when the app has no web connector or it already serves", async () => {
    expect(await startWebConnectorOn(server, undefined)).toBeUndefined();

    const running = fakeWeb(true);

    expect(await startWebConnectorOn(server, running.connector)).toBeUndefined();
    expect(running.calls).toEqual([]);
  });

  it("shuts the connector down and rethrows when it fails to boot", async () => {
    const { connector, calls } = fakeWeb();

    vi.mocked(connector.boot).mockRejectedValueOnce(new Error("vite failed"));

    await expect(startWebConnectorOn(server, connector)).rejects.toThrow("vite failed");
    expect(calls).toEqual(["shutdown"]);
  });
});
