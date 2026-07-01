import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogChannel } from "../log-channel";
import { log } from "../logger";
import type { LoggingData } from "../types";
import { captureAnyUnhandledRejection } from "./capture-unhandled-errors";

class CapturingChannel extends LogChannel {
  public name = "capturing-unhandled";
  public terminal = false;
  public received: LoggingData[] = [];

  public log(data: LoggingData) {
    this.received.push({ ...data });
  }
}

class TerminalChannel extends LogChannel {
  public name = "terminal-capturing";
  public terminal = true;
  public received: LoggingData[] = [];

  public log(data: LoggingData) {
    this.received.push({ ...data });
  }
}

// Let the queued microtasks settle — the uncaughtException exit path runs a
// `flush → exit` race, so process.exit is called a tick after the listener.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("captureAnyUnhandledRejection", () => {
  const capturedRejection: NodeJS.UnhandledRejectionListener[] = [];
  const capturedException: NodeJS.UncaughtExceptionListener[] = [];
  let originalChannels: typeof log.channels;
  let channel: CapturingChannel;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    capturedRejection.length = 0;
    capturedException.length = 0;

    const originalOn = process.on.bind(process);

    vi.spyOn(process, "on").mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      if (event === "unhandledRejection") {
        capturedRejection.push(listener as NodeJS.UnhandledRejectionListener);
      } else if (event === "uncaughtException") {
        capturedException.push(listener as NodeJS.UncaughtExceptionListener);
      } else {
        return originalOn(event as never, listener as never);
      }

      return process;
    }) as typeof process.on);

    // The uncaughtException path calls process.exit — stub it so the runner is
    // not torn down, and assert on the call instead. console.error is the
    // no-terminal-channel fallback; silence + spy it.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => undefined) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    originalChannels = log.channels;
    channel = new CapturingChannel();
    log.channels = [channel];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    log.channels = originalChannels;
  });

  it("registers listeners for unhandledRejection and uncaughtException", () => {
    captureAnyUnhandledRejection();

    expect(capturedRejection).toHaveLength(1);
    expect(capturedException).toHaveLength(1);
  });

  it("routes captured unhandledRejection through log.error with module 'app'", async () => {
    captureAnyUnhandledRejection();

    const reason = new Error("rejected");
    const fakePromise = Promise.resolve();

    capturedRejection[0]!(reason, fakePromise);

    await tick();

    expect(channel.received).toHaveLength(1);
    expect(channel.received[0]!.type).toBe("error");
    expect(channel.received[0]!.module).toBe("app");
    expect(channel.received[0]!.action).toBe("unhandledRejection");
    expect(channel.received[0]!.message).toBe(reason);
  });

  it("does not exit the process on an unhandledRejection", async () => {
    captureAnyUnhandledRejection();

    capturedRejection[0]!(new Error("rejected"), Promise.resolve());

    await tick();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("routes captured uncaughtException through log.fatal with module 'app'", async () => {
    // uncaughtException terminates the Node process, so it's semantically fatal
    // — the helper escalates beyond log.error to make alerting/paging clean.
    captureAnyUnhandledRejection();

    const error = new Error("uncaught");

    capturedException[0]!(error, "uncaughtException");

    await tick();

    expect(channel.received).toHaveLength(1);
    expect(channel.received[0]!.type).toBe("fatal");
    expect(channel.received[0]!.module).toBe("app");
    expect(channel.received[0]!.action).toBe("uncaughtException");
    expect(channel.received[0]!.message).toBe(error);
  });

  it("exits with a non-zero code after an uncaughtException by default", async () => {
    captureAnyUnhandledRejection();

    capturedException[0]!(new Error("boom"), "uncaughtException");

    await tick();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs but does NOT exit when exitOnUncaughtException is false", async () => {
    captureAnyUnhandledRejection({ exitOnUncaughtException: false });

    capturedException[0]!(new Error("boom"), "uncaughtException");

    await tick();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(channel.received[0]!.type).toBe("fatal");
  });

  it("falls back to console.error when no terminal channel is configured", async () => {
    // CapturingChannel.terminal === false, so nothing the user can see printed
    // the stack — the fallback stands in for the suppressed Node default.
    captureAnyUnhandledRejection({ exitOnUncaughtException: false });

    const error = new Error("invisible-without-fallback");

    capturedException[0]!(error, "uncaughtException");

    await tick();

    expect(errorSpy).toHaveBeenCalledWith(error);
  });

  it("does not double-print to console.error when a terminal channel exists", async () => {
    const terminalChannel = new TerminalChannel();
    log.channels = [terminalChannel];

    captureAnyUnhandledRejection({ exitOnUncaughtException: false });

    capturedException[0]!(new Error("printed-by-console-channel"), "uncaughtException");

    await tick();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(terminalChannel.received).toHaveLength(1);
  });

  it("does not throw when log has no channels", () => {
    log.channels = [];

    captureAnyUnhandledRejection({ exitOnUncaughtException: false });

    expect(() => {
      capturedRejection[0]!(new Error("x"), Promise.resolve());
      capturedException[0]!(new Error("y"), "uncaughtException");
    }).not.toThrow();
  });
});
