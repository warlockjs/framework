import { LogChannel, log } from "@warlock.js/logger";
import type { LoggingData } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorsManager } from "../../../src/connectors/connectors-manager";
import { ConnectorLifecyclePhase } from "../../../src/connectors/types";
import type { Connector, ConnectorName } from "../../../src/connectors/types";

/**
 * SCOPE — read this before trusting a green.
 *
 * These specs assert one thing: that a THROWING LOG CHANNEL cannot abort
 * `ConnectorsManager.shutdown()`. `gracefulShutdown` calls `process.exit(0)`
 * only after `shutdown()` RESOLVES, so anything other than a resolve there
 * means the process never exits on its own — it sits on whatever handles the
 * connectors it never reached are still holding.
 *
 * Nothing here is mocked. The real `log` singleton fans out to a real channel
 * whose `log()` throws synchronously — the same path a channel takes when its
 * transport is misconfigured or its formatter hits an unserialisable payload.
 * A `vi.spyOn(log, "error")` would have proved nothing: the defect lives in
 * `Logger.log()`'s un-isolated fan-out, which a mock replaces.
 *
 * Every outcome is NAMED rather than left to the runner — see
 * {@link observeShutdown}. A hang and a rejection are different defects with
 * different fixes, and a runner timeout is indistinguishable from an
 * environmental stall.
 *
 * What these specs do NOT assert:
 *
 * 1. That the entry reaches the OTHER channels. It does not — `Logger.log()`
 *    aborts its fan-out loop on the first throwing channel. That is a logger
 *    defect with a logger-side fix; `ConnectorsManager` cannot reach it.
 * 2. That an ASYNC-rejecting channel is isolated. `Logger.log()` never awaits
 *    `channel.log()`, so an async rejection surfaces as an unhandled rejection
 *    elsewhere and never reaches this call site at all.
 */

type ShutdownOutcome = "resolved" | "rejected" | "hung";

/** Long enough for any in-process teardown; short enough not to stall the suite. */
const HANG_THRESHOLD_MS = 500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `shutdown()` and report which of the three outcomes actually happened.
 *
 * Asserting on this string rather than on the promise means the red reads
 * `expected 'rejected' to be 'resolved'` — a statement about the code — instead
 * of a runner timeout, which in this suite is far more often environmental than
 * real.
 */
async function observeShutdown(manager: ConnectorsManager): Promise<ShutdownOutcome> {
  return Promise.race<ShutdownOutcome>([
    manager.shutdown().then(
      (): ShutdownOutcome => "resolved",
      (): ShutdownOutcome => "rejected",
    ),
    delay(HANG_THRESHOLD_MS).then((): ShutdownOutcome => "hung"),
  ]);
}

/** Restores the singleton's channel list — `log` is shared across the suite. */
let originalChannels: LogChannel[] = [];

/**
 * A channel whose `log()` throws synchronously, the way a channel with a bad
 * transport or an unserialisable payload does.
 */
class ThrowingChannel extends LogChannel {
  public name = "throwing";

  public log(_data: LoggingData): void {
    throw new Error("channel exploded");
  }
}

/**
 * A channel that records whether the shutdown drain reached it. Registered
 * after {@link ThrowingChannel} so it can only be drained via `log.flush()`,
 * which iterates channels independently of the fan-out loop.
 */
class RecordingChannel extends LogChannel {
  public name = "recording";

  public flushed = false;

  public log(_data: LoggingData): void {}

  public override flush(): void {
    this.flushed = true;
  }
}

/**
 * A connector whose `shutdown()` rejects, so the manager takes its error path
 * and reaches the logger call under test.
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

/** Records that it was reached, instead of failing. */
class SurvivingConnector extends FailingConnector {
  public wasShutDown = false;

  public override async shutdown(): Promise<void> {
    this.wasShutDown = true;
  }
}

describe("ConnectorsManager — a throwing log channel cannot abort shutdown", () => {
  beforeEach(() => {
    originalChannels = log.channels;
  });

  afterEach(() => {
    log.setChannels(originalChannels);
  });

  it("resolves even when the log channel throws while reporting a failed connector", async () => {
    log.setChannels([new ThrowingChannel()]);

    const manager = new ConnectorsManager();

    manager.register(
      new FailingConnector("failing" as ConnectorName, 9100, ConnectorLifecyclePhase.Early),
    );

    // `shutdownOnProcessKill` calls `process.exit(0)` on the line after this
    // resolves. Any other outcome means the exit never runs.
    expect(await observeShutdown(manager)).toBe("resolved");
  });

  it("still drains the logger after a channel throws", async () => {
    const recording = new RecordingChannel();

    log.setChannels([new ThrowingChannel(), recording]);

    const manager = new ConnectorsManager();

    manager.register(
      new FailingConnector("failing" as ConnectorName, 9101, ConnectorLifecyclePhase.Early),
    );

    await observeShutdown(manager);

    // The drain is the last statement of `shutdown()`. An abort on the
    // error-reporting line above skips it, and every buffered entry from the
    // whole run — not just this one — is lost at exit.
    expect(recording.flushed).toBe(true);
  });

  it("keeps shutting down the remaining connectors after a channel throws", async () => {
    log.setChannels([new ThrowingChannel()]);

    // Lower priority shuts down LAST — the reverse loop reaches the failing
    // connector first, so this one is only reached if the loop survives it.
    const survivor = new SurvivingConnector(
      "survivor" as ConnectorName,
      9199,
      ConnectorLifecyclePhase.Early,
    );

    const manager = new ConnectorsManager();

    manager.register(
      new FailingConnector("failing" as ConnectorName, 9200, ConnectorLifecyclePhase.Early),
      survivor,
    );

    await observeShutdown(manager);

    expect(survivor.wasShutDown).toBe(true);
  });
});
