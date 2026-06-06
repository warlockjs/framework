import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogChannel } from "./log-channel";
import { log, Logger } from "./logger";
import type { LoggingData } from "./types";

class CapturingChannel extends LogChannel {
  public name = "capturing";
  public terminal = false;
  public received: LoggingData[] = [];
  public flushed = 0;
  public asyncFlushed = 0;

  public log(data: LoggingData) {
    this.received.push({ ...data });
  }

  public flushSync() {
    this.flushed += 1;
  }

  public async flush() {
    this.asyncFlushed += 1;
  }
}

class TerminalChannel extends LogChannel {
  public name = "terminal";
  public terminal = true;
  public received: LoggingData[] = [];

  public log(data: LoggingData) {
    this.received.push({ ...data });
  }
}

class NoFlushChannel extends LogChannel {
  public name = "no-flush";
  public terminal = false;
  public received: LoggingData[] = [];

  public log(data: LoggingData) {
    this.received.push(data);
  }
}

class RejectingFlushChannel extends LogChannel {
  public name = "rejecting-flush";
  public terminal = false;

  public log(_data: LoggingData) {}

  public async flush() {
    throw new Error("flush failed");
  }
}

describe("Logger", () => {
  describe("construction", () => {
    it("starts with an empty channels array", () => {
      const instance = new Logger();

      expect(instance.channels).toEqual([]);
    });

    it("assigns a unique id to every instance", () => {
      const first = new Logger();
      const second = new Logger();

      expect(first.id).not.toBe(second.id);
      expect(first.id.startsWith("logger-")).toBe(true);
    });
  });

  describe("channel management", () => {
    it("addChannel appends and returns this for chaining", () => {
      const instance = new Logger();
      const channel = new CapturingChannel();

      const result = instance.addChannel(channel);

      expect(result).toBe(instance);
      expect(instance.channels).toEqual([channel]);
    });

    it("addChannel preserves existing channels", () => {
      const instance = new Logger();
      const first = new CapturingChannel();
      const second = new TerminalChannel();

      instance.addChannel(first).addChannel(second);

      expect(instance.channels).toEqual([first, second]);
    });

    it("setChannels replaces the channel list", () => {
      const instance = new Logger();
      instance.addChannel(new CapturingChannel());

      const replacement = new TerminalChannel();
      const result = instance.setChannels([replacement]);

      expect(result).toBe(instance);
      expect(instance.channels).toEqual([replacement]);
    });

    it("configure replaces the channel list", () => {
      const instance = new Logger();
      instance.addChannel(new CapturingChannel());

      const replacement = new TerminalChannel();
      const result = instance.configure({ channels: [replacement] });

      expect(result).toBe(instance);
      expect(instance.channels).toEqual([replacement]);
    });

    it("channel() returns matching channel", () => {
      const instance = new Logger();
      const capturing = new CapturingChannel();
      instance.addChannel(capturing);

      expect(instance.channel("capturing")).toBe(capturing);
    });

    it("channel() returns undefined when not found", () => {
      const instance = new Logger();

      expect(instance.channel("missing")).toBeUndefined();
    });
  });

  describe("broadcast", () => {
    it("log() dispatches to every registered channel", async () => {
      const instance = new Logger();
      const first = new CapturingChannel();
      const second = new CapturingChannel();

      instance.setChannels([first, second]);

      await instance.log({
        type: "info",
        module: "auth",
        action: "login",
        message: "ok",
      });

      expect(first.received).toHaveLength(1);
      expect(second.received).toHaveLength(1);
    });

    it("log() returns a promise resolving to the logger instance", async () => {
      const instance = new Logger();
      instance.addChannel(new CapturingChannel());

      const result = await instance.log({
        type: "info",
        module: "m",
        action: "a",
        message: "x",
      });

      expect(result).toBe(instance);
    });

    it("strips ANSI codes before delivering to non-terminal channels", async () => {
      const instance = new Logger();
      const nonTerminal = new CapturingChannel();

      instance.addChannel(nonTerminal);

      await instance.log({
        type: "info",
        module: "m",
        action: "a",
        message: "\u001b[31mred\u001b[0m",
      });

      expect(nonTerminal.received[0]!.message).toBe("red");
    });

    it("does not strip ANSI for terminal channels (message mutated once on data object)", async () => {
      const instance = new Logger();
      const terminal = new TerminalChannel();

      instance.addChannel(terminal);

      await instance.log({
        type: "info",
        module: "m",
        action: "a",
        message: "\u001b[31mred\u001b[0m",
      });

      expect(terminal.received[0]!.message).toBe("\u001b[31mred\u001b[0m");
    });
  });

  describe("level shortcut methods", () => {
    const levels = ["debug", "info", "warn", "error", "success", "fatal"] as const;

    for (const level of levels) {
      it(`${level}() produces type "${level}" using 4-arg form`, async () => {
        const instance = new Logger();
        const channel = new CapturingChannel();
        instance.addChannel(channel);

        await instance[level]("mod", "act", "msg", { user: 1 });

        expect(channel.received[0]).toEqual({
          type: level,
          module: "mod",
          action: "act",
          message: "msg",
          context: { user: 1 },
        });
      });

      it(`${level}() produces type "${level}" using object form`, async () => {
        const instance = new Logger();
        const channel = new CapturingChannel();
        instance.addChannel(channel);

        await instance[level]({
          module: "mod",
          action: "act",
          message: "msg",
        });

        expect(channel.received[0]!.type).toBe(level);
        expect(channel.received[0]!.module).toBe("mod");
        expect(channel.received[0]!.action).toBe("act");
        expect(channel.received[0]!.message).toBe("msg");
      });
    }

    it("passes context through the 4-arg form", async () => {
      const instance = new Logger();
      const channel = new CapturingChannel();
      instance.addChannel(channel);

      await instance.info("mod", "act", "msg", { traceId: "abc" });

      expect(channel.received[0]!.context).toEqual({ traceId: "abc" });
    });

    it("the level shortcut wins over a type carried on the object form", async () => {
      const instance = new Logger();
      const channel = new CapturingChannel();
      instance.addChannel(channel);

      // The object claims `error`, but `warn()` was the entry point — the
      // method's level overrides the object's type.
      await instance.warn({
        type: "error",
        module: "m",
        action: "a",
        message: "x",
      } as Parameters<typeof instance.warn>[0]);

      expect(channel.received[0]!.type).toBe("warn");
    });

    it("omits context when not provided", async () => {
      const instance = new Logger();
      const channel = new CapturingChannel();
      instance.addChannel(channel);

      await instance.info("mod", "act", "msg");

      expect(channel.received[0]!.context).toBeUndefined();
    });

    it("explicit context argument overrides the object form's context", async () => {
      const instance = new Logger();
      const channel = new CapturingChannel();
      instance.addChannel(channel);

      await instance.info(
        { module: "m", action: "a", message: "x", context: { a: 1 } },
        undefined,
        undefined,
        { b: 2 },
      );

      expect(channel.received[0]!.context).toEqual({ b: 2 });
    });

    it("object form preserves context when no explicit context is passed", async () => {
      const instance = new Logger();
      const channel = new CapturingChannel();
      instance.addChannel(channel);

      await instance.info({ module: "m", action: "a", message: "x", context: { a: 1 } });

      expect(channel.received[0]!.context).toEqual({ a: 1 });
    });
  });

  describe("flushSync", () => {
    it("invokes flushSync on every channel that defines it", () => {
      const instance = new Logger();
      const flushable = new CapturingChannel();

      instance.addChannel(flushable);

      instance.flushSync();

      expect(flushable.flushed).toBe(1);
    });

    it("skips channels that do not implement flushSync", () => {
      const instance = new Logger();
      const noFlush = new NoFlushChannel();
      const flushable = new CapturingChannel();

      instance.setChannels([noFlush, flushable]);

      expect(() => instance.flushSync()).not.toThrow();
      expect(flushable.flushed).toBe(1);
    });
  });

  describe("flush", () => {
    it("awaits flush on every channel that implements it", async () => {
      const instance = new Logger();
      const first = new CapturingChannel();
      const second = new CapturingChannel();

      instance.setChannels([first, second]);

      await instance.flush();

      expect(first.asyncFlushed).toBe(1);
      expect(second.asyncFlushed).toBe(1);
    });

    it("skips channels that do not implement flush", async () => {
      const instance = new Logger();
      const noFlush = new NoFlushChannel();
      const flushable = new CapturingChannel();

      instance.setChannels([noFlush, flushable]);

      await expect(instance.flush()).resolves.toBeUndefined();
      expect(flushable.asyncFlushed).toBe(1);
    });

    it("isolates a channel whose flush rejects so the others still drain", async () => {
      const instance = new Logger();
      const rejecting = new RejectingFlushChannel();
      const healthy = new CapturingChannel();

      instance.setChannels([rejecting, healthy]);

      await expect(instance.flush()).resolves.toBeUndefined();
      expect(healthy.asyncFlushed).toBe(1);
    });
  });
});

describe("auto-flush", () => {
  const registered: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    registered.length = 0;

    const originalOn = process.on.bind(process);
    const originalOff = process.off.bind(process);

    vi.spyOn(process, "on").mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
      registered.push({ event, handler });
      return process;
    }) as typeof process.on);

    vi.spyOn(process, "off").mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
      const index = registered.findIndex((entry) => entry.event === event && entry.handler === handler);

      if (index >= 0) {
        registered.splice(index, 1);
      }

      return process;
    }) as typeof process.off);

    killSpy = vi.spyOn(process, "kill").mockImplementation((() => true) as typeof process.kill);

    void originalOn;
    void originalOff;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers one handler per event", () => {
    const instance = new Logger();

    instance.enableAutoFlush(["SIGINT", "SIGTERM", "beforeExit"]);

    const events = registered.map((entry) => entry.event);

    expect(events).toEqual(["SIGINT", "SIGTERM", "beforeExit"]);
  });

  it("beforeExit handler flushes but does not re-raise", () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    instance.enableAutoFlush(["beforeExit"]);

    const entry = registered.find((item) => item.event === "beforeExit")!;
    entry.handler();

    expect(channel.flushed).toBe(1);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("signal handler flushes, removes itself, then re-raises the signal", () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    instance.enableAutoFlush(["SIGINT"]);

    const entry = registered.find((item) => item.event === "SIGINT")!;
    entry.handler();

    expect(channel.flushed).toBe(1);
    expect(registered.find((item) => item.event === "SIGINT")).toBeUndefined();
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT");
  });

  it("is idempotent — second call replaces previous handlers", () => {
    const instance = new Logger();

    instance.enableAutoFlush(["SIGINT"]);
    instance.enableAutoFlush(["SIGINT"]);

    const count = registered.filter((entry) => entry.event === "SIGINT").length;

    expect(count).toBe(1);
  });

  it("disableAutoFlush removes every registered handler", () => {
    const instance = new Logger();

    instance.enableAutoFlush(["SIGINT", "SIGTERM", "beforeExit"]);
    instance.disableAutoFlush();

    expect(registered).toEqual([]);
  });

  it("disableAutoFlush is safe to call with nothing registered", () => {
    const instance = new Logger();

    expect(() => instance.disableAutoFlush()).not.toThrow();
  });

  it("configure({ autoFlushOn }) wires up handlers alongside channels", () => {
    const instance = new Logger();
    const channel = new CapturingChannel();

    instance.configure({
      channels: [channel],
      autoFlushOn: ["beforeExit"],
    });

    const entry = registered.find((item) => item.event === "beforeExit")!;
    entry.handler();

    expect(channel.flushed).toBe(1);
  });

  it("configure without channels key preserves existing channels", () => {
    const instance = new Logger();
    const channel = new CapturingChannel();

    instance.addChannel(channel);
    instance.configure({ autoFlushOn: ["beforeExit"] });

    expect(instance.channels).toEqual([channel]);
  });
});

describe("Logger — minLevel", () => {
  it("starts unset and accepts every level", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    expect(instance.getMinLevel()).toBeUndefined();

    await instance.debug("m", "a", "x");
    await instance.info("m", "a", "x");
    await instance.error("m", "a", "x");

    expect(channel.received).toHaveLength(3);
  });

  it("drops entries below the configured minimum severity", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    instance.setMinLevel("warn");

    await instance.debug("m", "a", "x");
    await instance.info("m", "a", "x");
    await instance.success("m", "a", "x");
    await instance.warn("m", "a", "x");
    await instance.error("m", "a", "x");

    expect(channel.received.map((e) => e.type)).toEqual(["warn", "error"]);
  });

  it("clears the minimum when set to undefined", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    instance.setMinLevel("error");
    await instance.info("m", "a", "x");
    expect(channel.received).toHaveLength(0);

    instance.setMinLevel(undefined);
    await instance.info("m", "a", "x");
    expect(channel.received).toHaveLength(1);
  });

  it("configure({ minLevel }) wires the same filter", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.configure({ channels: [channel], minLevel: "warn" });

    await instance.info("m", "a", "x");
    await instance.error("m", "a", "x");

    expect(channel.received.map((e) => e.type)).toEqual(["error"]);
  });

  it("setMinLevel returns this for chaining", () => {
    const instance = new Logger();
    expect(instance.setMinLevel("info")).toBe(instance);
  });

  it("keeps entries whose rank equals the minimum (boundary is inclusive)", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    // The filter drops entries strictly below the minimum, so an entry at the
    // exact minimum rank is kept.
    instance.setMinLevel("warn");

    await instance.warn("m", "a", "x");

    expect(channel.received.map((e) => e.type)).toEqual(["warn"]);
  });

  it("treats success and info as the same rank (success passes a minLevel of info, and vice versa)", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    // `success` and `info` both rank 1 — neither can filter the other out.
    instance.setMinLevel("info");
    await instance.success("m", "a", "s1");

    instance.setMinLevel("success");
    await instance.info("m", "a", "i1");

    expect(channel.received.map((e) => e.type)).toEqual(["success", "info"]);
  });

  it("a debug minimum admits every level", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    instance.setMinLevel("debug");

    await instance.debug("m", "a", "x");
    await instance.info("m", "a", "x");
    await instance.success("m", "a", "x");
    await instance.warn("m", "a", "x");
    await instance.error("m", "a", "x");
    await instance.fatal("m", "a", "x");

    expect(channel.received).toHaveLength(6);
  });

  it("an error minimum admits error and fatal entries (fatal is strictly above error)", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    instance.setMinLevel("error");

    await instance.debug("m", "a", "x");
    await instance.info("m", "a", "x");
    await instance.success("m", "a", "x");
    await instance.warn("m", "a", "x");
    await instance.error("m", "a", "x");
    await instance.fatal("m", "a", "x");

    expect(channel.received.map((e) => e.type)).toEqual(["error", "fatal"]);
  });

  it("a fatal minimum admits only fatal entries", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    instance.setMinLevel("fatal");

    await instance.debug("m", "a", "x");
    await instance.info("m", "a", "x");
    await instance.success("m", "a", "x");
    await instance.warn("m", "a", "x");
    await instance.error("m", "a", "x");
    await instance.fatal("m", "a", "x");

    expect(channel.received.map((e) => e.type)).toEqual(["fatal"]);
  });

  it("skips fan-out entirely when an entry is below the minimum", async () => {
    // A dropped entry must never reach a channel — not even a terminal one
    // that would otherwise mutate the message.
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);
    instance.setMinLevel("error");

    const result = await instance.info("m", "a", "x");

    expect(channel.received).toHaveLength(0);
    expect(result).toBe(instance);
  });
});

describe("Logger — assert", () => {
  it("emits an error entry when condition is falsy", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    await instance.assert(false, "auth", "session", "user vanished", { id: 1 });

    expect(channel.received).toHaveLength(1);
    expect(channel.received[0]!.type).toBe("error");
    expect(channel.received[0]!.module).toBe("auth");
    expect(channel.received[0]!.action).toBe("session");
    expect(channel.received[0]!.message).toBe("user vanished");
    expect(channel.received[0]!.context).toEqual({ id: 1 });
  });

  it("is a no-op when condition is truthy", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    await instance.assert(true, "m", "a", "should not log");

    expect(channel.received).toHaveLength(0);
  });

  it("treats common falsy values as failures", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    await instance.assert(0, "m", "a", "zero");
    await instance.assert("", "m", "a", "empty");
    await instance.assert(null, "m", "a", "null");
    await instance.assert(undefined, "m", "a", "undefined");

    expect(channel.received).toHaveLength(4);
  });
});

describe("Logger — timer", () => {
  it("emits an info entry with durationMs when end() is called", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    const end = instance.timer("db", "users.findById");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await end();

    expect(channel.received).toHaveLength(1);
    expect(channel.received[0]!.type).toBe("info");
    expect(channel.received[0]!.module).toBe("db");
    expect(channel.received[0]!.action).toBe("users.findById");
    expect(channel.received[0]!.message).toMatch(/^completed in \d+ms$/);
    expect(channel.received[0]!.context!.durationMs).toBeGreaterThanOrEqual(10);
  });

  it("merges extra context passed to end()", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    const end = instance.timer("db", "query");
    await end({ rows: 42, found: true });

    expect(channel.received[0]!.context).toMatchObject({
      rows: 42,
      found: true,
    });
    expect(channel.received[0]!.context!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("end() can be called more than once independently", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);

    const end = instance.timer("m", "a");
    await end();
    await end();

    expect(channel.received).toHaveLength(2);
  });
});

describe("Logger — redact", () => {
  it("starts with no redact config", () => {
    const instance = new Logger();
    expect(instance.getRedact()).toBeUndefined();
  });

  it("setRedact stores the config and returns this", () => {
    const instance = new Logger();
    const result = instance.setRedact({ paths: ["context.password"] });

    expect(result).toBe(instance);
    expect(instance.getRedact()).toEqual({ paths: ["context.password"] });
  });

  it("configure({ redact }) wires the same floor", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.configure({
      channels: [channel],
      redact: { paths: ["context.password"] },
    });

    await instance.info("auth", "login", "ok", { password: "x", role: "admin" });

    expect(channel.received[0]!.context).toEqual({
      password: "[REDACTED]",
      role: "admin",
    });
  });

  it("applies the logger-wide floor to every channel", async () => {
    const instance = new Logger();
    const a = new CapturingChannel();
    const b = new CapturingChannel();
    instance.setChannels([a, b]);
    instance.setRedact({ paths: ["context.password"] });

    await instance.info("m", "a", "x", { password: "secret" });

    expect(a.received[0]!.context!.password).toBe("[REDACTED]");
    expect(b.received[0]!.context!.password).toBe("[REDACTED]");
  });

  it("never mutates the input data", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);
    instance.setRedact({ paths: ["context.password"] });

    const ctx = { password: "secret", role: "admin" };
    await instance.info("m", "a", "x", ctx);

    expect(ctx.password).toBe("secret");
    expect(channel.received[0]!.context!.password).toBe("[REDACTED]");
  });

  it("clears the floor when set to undefined", async () => {
    const instance = new Logger();
    const channel = new CapturingChannel();
    instance.addChannel(channel);
    instance.setRedact({ paths: ["context.password"] });
    instance.setRedact(undefined);

    await instance.info("m", "a", "x", { password: "secret" });

    expect(channel.received[0]!.context!.password).toBe("secret");
  });

  describe("per-channel additive redaction", () => {
    class RedactingChannel extends LogChannel {
      public name = "redacting";
      public terminal = false;
      public received: LoggingData[] = [];

      public constructor(redact: any) {
        super({ redact });
      }

      public log(data: LoggingData) {
        this.received.push(data);
      }
    }

    it("a channel can redact more paths than the logger floor", async () => {
      const instance = new Logger();
      const plain = new CapturingChannel();
      const aggressive = new RedactingChannel({
        paths: ["context.email"],
      });
      instance.setChannels([plain, aggressive]);
      instance.setRedact({ paths: ["context.password"] });

      await instance.info("m", "a", "x", {
        password: "secret",
        email: "x@y.com",
        role: "admin",
      });

      // Plain channel — sees logger floor only.
      expect(plain.received[0]!.context).toEqual({
        password: "[REDACTED]",
        email: "x@y.com",
        role: "admin",
      });

      // Aggressive channel — adds email on top of the password floor.
      expect(aggressive.received[0]!.context).toEqual({
        password: "[REDACTED]",
        email: "[REDACTED]",
        role: "admin",
      });
    });

    it("a channel cannot undo a logger-wide redaction", async () => {
      // Even when the channel has no redact config, the logger-wide floor
      // still applies — the additive contract holds.
      const instance = new Logger();
      const channel = new CapturingChannel();
      instance.addChannel(channel);
      instance.setRedact({ paths: ["context.password"] });

      await instance.info("m", "a", "x", { password: "secret" });

      expect(channel.received[0]!.context!.password).toBe("[REDACTED]");
    });

    it("channel censor overrides the logger censor", async () => {
      const instance = new Logger();
      const channel = new RedactingChannel({
        paths: ["context.email"],
        censor: "***",
      });
      instance.addChannel(channel);
      instance.setRedact({
        paths: ["context.password"],
        censor: "[REDACTED]",
      });

      await instance.info("m", "a", "x", {
        password: "secret",
        email: "x@y.com",
      });

      // Channel-level censor wins for both paths in the merged config.
      expect(channel.received[0]!.context!.password).toBe("***");
      expect(channel.received[0]!.context!.email).toBe("***");
    });

    it("channel censor falls back to logger censor when omitted", async () => {
      const instance = new Logger();
      const channel = new RedactingChannel({ paths: ["context.email"] });
      instance.addChannel(channel);
      instance.setRedact({
        paths: ["context.password"],
        censor: "[FLOOR]",
      });

      await instance.info("m", "a", "x", {
        password: "secret",
        email: "x@y.com",
      });

      expect(channel.received[0]!.context!.password).toBe("[FLOOR]");
      expect(channel.received[0]!.context!.email).toBe("[FLOOR]");
    });
  });
});

describe("log singleton", () => {
  it("is a Logger instance", () => {
    expect(log).toBeInstanceOf(Logger);
  });

  it("singleton survives reassignment of channels across describes", () => {
    // Sanity check — confirm the package exports a single shared instance
    // (not a fresh one per import).
    const channel = new CapturingChannel();
    log.addChannel(channel);
    expect(log.channels).toContain(channel);
    log.channels = [];
  });
});
