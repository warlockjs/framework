import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { CdpConnection } from "./cdp";
import { fakeCdp } from "./fake-cdp.test-support";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function connect(handler?: Parameters<typeof fakeCdp>[0]) {
  const endpoint = await fakeCdp(handler);
  cleanups.push(endpoint.close);
  const cdp = await CdpConnection.connect(endpoint.url);
  cleanups.push(() => cdp.close());
  return { endpoint, cdp };
}

describe("native WebSocket CDP transport", () => {
  it("correlates concurrent replies even when they arrive out of order", async () => {
    const { cdp } = await connect(async ({ method }) => {
      if (method === "Runtime.enable") await delay(30);
      return { result: { method } };
    });
    const slow = cdp.command("Runtime.enable", {});
    const fast = cdp.command("Page.enable", {});
    expect(await fast).toEqual({ method: "Page.enable" });
    expect(await slow).toEqual({ method: "Runtime.enable" });
  });

  it("delivers protocol events and removes subscriptions", async () => {
    const { endpoint, cdp } = await connect();
    let count = 0;
    const remove = cdp.on("Page.loadEventFired", () => {
      count++;
    });
    endpoint.event("Page.loadEventFired", { timestamp: 1 });
    await delay(20);
    expect(count).toBe(1);
    remove();
    endpoint.event("Page.loadEventFired", { timestamp: 2 });
    await delay(20);
    expect(count).toBe(1);
  });

  it("reports protocol errors and bounded command timeouts", async () => {
    const { cdp } = await connect(({ method }) =>
      method === "Runtime.enable" ? { error: { message: "Unsupported domain" } } : undefined,
    );
    await expect(cdp.command("Runtime.enable", {})).rejects.toThrow("Unsupported domain");
    await expect(cdp.command("Page.enable", {}, 20)).rejects.toThrow(
      "CDP timeout after 20ms: Page.enable",
    );
  });

  it("rejects pending and future calls on disconnect", async () => {
    const { endpoint, cdp } = await connect(() => undefined);
    const pending = expect(cdp.command("Page.enable", {})).rejects.toThrow(/closed|WebSocket/);
    endpoint.disconnect();
    await pending;
    await expect(cdp.command("Page.enable", {})).rejects.toThrow("CDP closed");
  });

  it("rejects an unavailable endpoint within a bounded connection timeout", async () => {
    const endpoint = await fakeCdp();
    await endpoint.close();
    await expect(CdpConnection.connect(endpoint.url, 100)).rejects.toThrow("Cannot connect");
  });
});
