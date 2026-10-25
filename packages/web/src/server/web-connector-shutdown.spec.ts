import type { ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";

vi.mock("../sitemap/sitemap-lifecycle", () => ({
  refreshSitemapModelSubscriptions: vi.fn(async () => undefined),
  shutdownSitemapRuntime: vi.fn(async () => undefined),
}));

import { WebConnector } from "./web-connector";

type Calls = string[];

function fakeVite(calls: Calls, failures: { close?: boolean } = {}): ViteDevServer {
  return {
    ws: { close: vi.fn(async () => void calls.push("ws")) },
    watcher: { close: vi.fn(async () => void calls.push("watcher")) },
    close: vi.fn(async () => {
      calls.push("vite");

      if (failures.close) throw new Error("close failed");
    }),
  } as unknown as ViteDevServer;
}

class SeededConnector extends WebConnector {
  public seed(vite: ViteDevServer, active: boolean): void {
    this.vite = vite;
    this.active = active;
  }

  public hasVite(): boolean {
    return this.vite !== undefined;
  }
}

describe("WebConnector.shutdown", () => {
  it("closes the HMR socket, the watchers and Vite", async () => {
    const calls: Calls = [];
    const connector = new SeededConnector();

    connector.seed(fakeVite(calls), true);
    await connector.shutdown();

    expect(calls).toEqual(["ws", "watcher", "vite"]);
    expect(connector.hasVite()).toBe(false);
  });

  it("closes Vite when boot created it but start never ran", async () => {
    const calls: Calls = [];
    const connector = new SeededConnector();

    connector.seed(fakeVite(calls), false);
    await connector.shutdown();

    expect(calls).toContain("vite");
    expect(connector.hasVite()).toBe(false);
  });

  it("closes Vite even when a step fails, then reports the failure", async () => {
    const calls: Calls = [];
    const connector = new SeededConnector();

    connector.seed(fakeVite(calls, { close: true }), true);

    await expect(connector.shutdown()).rejects.toThrow("close failed");
    expect(calls).toEqual(["ws", "watcher", "vite"]);
    expect(connector.hasVite()).toBe(false);
  });

  it("is safe to call twice", async () => {
    const calls: Calls = [];
    const connector = new SeededConnector();

    connector.seed(fakeVite(calls), true);
    await connector.shutdown();
    await connector.shutdown();

    expect(calls.filter((call) => call === "vite")).toHaveLength(1);
  });
});
