import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorsManager } from "../../../src/connectors/connectors-manager";
import { ConnectorLifecyclePhase } from "../../../src/connectors/types";
import type { Connector, ConnectorName } from "../../../src/connectors/types";

/**
 * SCOPE — read this before trusting a green.
 *
 * These specs assert one thing only: that `ConnectorsManager.shutdown()` AWAITS
 * the logger, so a connector's shutdown failure has actually reached its channel
 * by the time `shutdown()` resolves.
 *
 * They deliberately do NOT assert anything about the logger's own fan-out.
 * `Logger.log()` calls `channel.log(payload)` without awaiting it
 * (`logger/src/logger.ts`), which is why draining requires `log.flush()` and not
 * merely awaiting `log.error()`. Both are asserted here, separately.
 *
 * Why the fake logger resolves on a MACROTASK: a real channel does I/O (a disk
 * write, an HTTP post to Sentry). If the fake resolved synchronously or on a
 * microtask, an un-awaited call would still appear to have landed by the time
 * `shutdown()`'s own promise resolved, and this spec would pass against the
 * defect it exists to catch.
 */

/** Resolve on a macrotask, the way a real channel's I/O does. */
const afterIo = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * A connector whose `shutdown()` rejects, so the manager takes its error path.
 */
class FailingConnector implements Connector {
  public active = true;

  public constructor(
    public readonly name: ConnectorName,
    public readonly priority: number,
    public readonly lifecyclePhase: ConnectorLifecyclePhase,
  ) {}

  public isActive(): boolean {
    return this.active;
  }

  public async boot(): Promise<void> {}

  public async start(): Promise<void> {}

  public async restart(): Promise<void> {}

  public async shutdown(): Promise<void> {
    throw new Error("teardown failed");
  }

  public shouldRestart(): boolean {
    return false;
  }
}

describe("ConnectorsManager — shutdown error reaches its channel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has written the shutdown error before shutdown() resolves", async () => {
    let written = false;

    vi.spyOn(log, "error").mockImplementation(async () => {
      await afterIo();
      written = true;
      return log;
    });
    vi.spyOn(log, "flush").mockImplementation(async () => {
      await afterIo();
    });

    const manager = new ConnectorsManager();

    manager.register(new FailingConnector("failing" as ConnectorName, 9000, ConnectorLifecyclePhase.Early));

    await manager.shutdown();

    // `gracefulShutdown` calls `process.exit(0)` on the line after this resolves.
    // Anything not written by now is never written.
    expect(written).toBe(true);
  });

  it("drains the logger before shutdown() resolves", async () => {
    let drained = false;

    vi.spyOn(log, "error").mockImplementation(async () => log);
    vi.spyOn(log, "flush").mockImplementation(async () => {
      await afterIo();
      drained = true;
    });

    const manager = new ConnectorsManager();

    manager.register(new FailingConnector("failing" as ConnectorName, 9001, ConnectorLifecyclePhase.Early));

    await manager.shutdown();

    // Awaiting `log.error()` is not sufficient on its own: `Logger.log()` does
    // not await `channel.log()`, so a buffered or async channel still loses the
    // entry unless the manager drains it explicitly.
    expect(drained).toBe(true);
  });
});
