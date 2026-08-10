import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_SIGNAL_ENV_KEY,
  BOOT_SIGNAL_VERSION,
  isBootSignal,
  sendBootSignal,
  type BootSignal,
} from "../../../src/application/boot-signal";
import type { Application as ApplicationClass } from "../../../src/application/application";

// Keep the suite hermetic: the boot latch never reaches the real logger.
vi.mock("@warlock.js/logger", () => ({
  log: { error: vi.fn() },
}));

const signal: BootSignal = {
  type: "warlock:ready",
  version: BOOT_SIGNAL_VERSION,
  pid: 1234,
  at: "2026-08-10T09:00:00.000Z",
  environment: "production",
  runtimeStrategy: "production",
  bootDurationMs: 42,
  port: 3000,
};

/** Stand-in for `process.send`, which flushes then invokes its callback. */
const flushingSend = () => {
  return vi.fn(
    (
      _message: unknown,
      _sendHandle: unknown,
      _options: unknown,
      callback?: (error: Error | null) => void,
    ) => {
      callback?.(null);

      return true;
    },
  );
};

describe("sendBootSignal", () => {
  const originalSend = process.send;
  const originalDisconnect = process.disconnect;

  beforeEach(() => {
    process.env[BOOT_SIGNAL_ENV_KEY] = "1";
  });

  afterEach(() => {
    process.send = originalSend;
    process.disconnect = originalDisconnect;
    delete process.env[BOOT_SIGNAL_ENV_KEY];
  });

  it("does nothing when no parent opened an IPC channel", () => {
    // A bundle run directly (`node app.mjs`, Docker CMD) has no channel.
    process.send = undefined;

    expect(() => sendBootSignal(signal)).not.toThrow();
  });

  it("stays silent on a channel opened by a supervisor that is not ours", () => {
    // pm2 and vitest's own worker forks both hand a child an IPC channel for
    // their own protocol. Writing to one — and then closing it — corrupts that
    // protocol and can kill the process. Without the handshake flag, nothing.
    delete process.env[BOOT_SIGNAL_ENV_KEY];

    const send = flushingSend();
    const disconnect = vi.fn();
    process.send = send as unknown as typeof process.send;
    process.disconnect = disconnect;

    sendBootSignal(signal);

    expect(send).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("sends the signal when a parent is supervising", () => {
    const send = flushingSend();
    process.send = send as unknown as typeof process.send;
    process.disconnect = vi.fn();

    sendBootSignal(signal);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual(signal);
  });

  it("consumes the handshake flag so a spawned grandchild cannot inherit it", () => {
    process.send = flushingSend() as unknown as typeof process.send;
    process.disconnect = vi.fn();

    sendBootSignal(signal);

    expect(process.env[BOOT_SIGNAL_ENV_KEY]).toBeUndefined();
  });

  it("closes the channel once the message is flushed", () => {
    // An open channel refs the child's event loop, so a finished or wedged
    // process would stay alive and look exactly like a healthy server.
    const disconnect = vi.fn();
    process.send = flushingSend() as unknown as typeof process.send;
    process.disconnect = disconnect;

    sendBootSignal(signal);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("swallows a closed channel rather than killing a healthy app", () => {
    process.send = vi.fn(() => {
      throw new Error("channel closed");
    }) as unknown as typeof process.send;

    expect(() => sendBootSignal(signal)).not.toThrow();
  });
});

describe("isBootSignal", () => {
  it("accepts a ready signal", () => {
    expect(isBootSignal(signal)).toBe(true);
  });

  it("accepts a newer schema version — readiness is still readiness", () => {
    // An older CLI supervising a newer bundle must not report a healthy app as
    // failed just because the payload grew.
    expect(isBootSignal({ ...signal, version: 99, somethingNew: true })).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "warlock:ready"],
    ["a number", 1],
    ["an unrelated object", { type: "something-else", version: 1 }],
    ["an object with no type", { version: 1 }],
    ["an unversioned message", { type: "warlock:ready" }],
  ])("rejects %s", (_label, message) => {
    expect(isBootSignal(message)).toBe(false);
  });
});

describe("Application.markBooted readiness reporting", () => {
  const originalSend = process.send;
  const originalDisconnect = process.disconnect;
  let Application: typeof ApplicationClass;
  let send: ReturnType<typeof flushingSend>;

  beforeEach(async () => {
    // Fresh module per test so the static `booted` latch starts down.
    vi.resetModules();
    vi.clearAllMocks();

    send = flushingSend();
    process.send = send as unknown as typeof process.send;
    process.disconnect = vi.fn();
    process.env[BOOT_SIGNAL_ENV_KEY] = "1";

    ({ Application } = await import("../../../src/application/application"));
  }, 60_000);

  afterEach(() => {
    process.send = originalSend;
    process.disconnect = originalDisconnect;
    delete process.env[BOOT_SIGNAL_ENV_KEY];
  });

  it("reports readiness to the supervising parent", () => {
    Application.markBooted({
      environment: "production",
      runtimeStrategy: "production",
      bootDurationMs: 42,
    });

    expect(send.mock.calls[0][0]).toMatchObject({
      type: "warlock:ready",
      version: BOOT_SIGNAL_VERSION,
      pid: process.pid,
      environment: "production",
      runtimeStrategy: "production",
      bootDurationMs: 42,
    });
  });

  it("reports the bound http port when one was served", () => {
    Application.setServedPort(4040);

    Application.markBooted({ environment: "production", runtimeStrategy: "production" });

    expect(send.mock.calls[0][0]).toMatchObject({ port: 4040 });
  });

  it("omits the port for an app with no http connector", () => {
    Application.markBooted({ environment: "production", runtimeStrategy: "production" });

    expect((send.mock.calls[0][0] as BootSignal).port).toBeUndefined();
  });

  it("reports once even when markBooted is called twice", () => {
    const context = { environment: "production", runtimeStrategy: "production" } as const;

    Application.markBooted(context);
    Application.markBooted(context);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports before boot listeners run, so a slow listener cannot delay it", () => {
    const order: string[] = [];

    send.mockImplementation(() => {
      order.push("signal");

      return true;
    });

    Application.onceBooted(() => {
      order.push("listener");
    });

    Application.markBooted({ environment: "production", runtimeStrategy: "production" });

    expect(order[0]).toBe("signal");
  });
});
