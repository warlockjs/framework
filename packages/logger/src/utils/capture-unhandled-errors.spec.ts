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

describe("captureAnyUnhandledRejection", () => {
  const capturedRejection: NodeJS.UnhandledRejectionListener[] = [];
  const capturedException: NodeJS.UncaughtExceptionListener[] = [];
  let originalChannels: typeof log.channels;
  let channel: CapturingChannel;

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

    vi.spyOn(console, "log").mockImplementation(() => {});

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

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(channel.received).toHaveLength(1);
    expect(channel.received[0]!.type).toBe("error");
    expect(channel.received[0]!.module).toBe("app");
    expect(channel.received[0]!.action).toBe("unhandledRejection");
    expect(channel.received[0]!.message).toBe(reason);
  });

  it("routes captured uncaughtException through log.error with module 'app'", async () => {
    captureAnyUnhandledRejection();

    const error = new Error("uncaught");

    capturedException[0]!(error, "uncaughtException");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(channel.received).toHaveLength(1);
    expect(channel.received[0]!.type).toBe("error");
    expect(channel.received[0]!.module).toBe("app");
    expect(channel.received[0]!.action).toBe("uncaughtException");
    expect(channel.received[0]!.message).toBe(error);
  });

  it("does not throw when log has no channels", () => {
    log.channels = [];

    captureAnyUnhandledRejection();

    expect(() => {
      capturedRejection[0]!(new Error("x"), Promise.resolve());
      capturedException[0]!(new Error("y"), "uncaughtException");
    }).not.toThrow();
  });
});
