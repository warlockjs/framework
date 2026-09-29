import { describe, expect, it, vi } from "vitest";
import { HttpConnector } from "../../../src/connectors/http-connector";
import { onHttpServerRebuilt } from "../../../src/http/server-rebuilt";

/** Stubs the lifecycle so `restart()` runs without a real Fastify or port. */
class StubbedHttpConnector extends HttpConnector {
  public readonly order: string[] = [];

  public constructor(private readonly instances: object[]) {
    super();
  }

  public async shutdown(): Promise<void> {
    this.order.push("shutdown");
  }

  public async boot(): Promise<void> {
    this.http = this.instances.shift() as never;
    this.order.push("boot");
  }

  public async start(): Promise<void> {
    this.order.push("start");
  }
}

describe("HttpConnector.restart() rebuild signal", () => {
  it("announces the NEW instance after boot and before start", async () => {
    const next = { id: "new" };
    const connector = new StubbedHttpConnector([next]);
    const listener = vi.fn(() => connector.order.push("notified"));
    const off = onHttpServerRebuilt(listener);

    await connector.restart();
    off();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(next);
    expect(connector.order).toEqual(["shutdown", "boot", "notified", "start"]);
  });

  it("does not announce after unsubscribe", async () => {
    const connector = new StubbedHttpConnector([{}]);
    const listener = vi.fn();
    onHttpServerRebuilt(listener)();

    await connector.restart();

    expect(listener).not.toHaveBeenCalled();
  });
});
