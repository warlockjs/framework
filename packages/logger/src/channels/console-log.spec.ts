import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggingData } from "../types";
import { ConsoleLog } from "./console-log";

function dataFor(overrides: Partial<LoggingData> = {}): LoggingData {
  return {
    type: "info",
    module: "auth",
    action: "login",
    message: "hello",
    ...overrides,
  };
}

describe("ConsoleLog", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("identity", () => {
    it("is named 'console' and marked terminal", () => {
      const channel = new ConsoleLog();

      expect(channel.name).toBe("console");
      expect(channel.terminal).toBe(true);
    });
  });

  describe("level handling", () => {
    const levels = ["debug", "info", "warn", "error", "success", "fatal"] as const;

    for (const level of levels) {
      it(`logs a ${level} message through console.log`, () => {
        const channel = new ConsoleLog();

        channel.log(dataFor({ type: level }));

        expect(consoleSpy).toHaveBeenCalledTimes(1);
      });
    }

    it("emits the module, action and message in the output line", () => {
      const channel = new ConsoleLog();

      channel.log(dataFor({ module: "auth", action: "login", message: "ok" }));

      const args = consoleSpy.mock.calls[0]!.join(" ");

      expect(args).toContain("[auth]");
      expect(args).toContain("[login]");
      expect(args).toContain("ok");
    });

    it("logs the object as a second entry when message is an object", () => {
      const channel = new ConsoleLog();
      const payload = { foo: "bar" };

      channel.log(dataFor({ message: payload }));

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy.mock.calls[1]![0]).toBe(payload);
    });

    it("falls back to a plain [log] prefix for an unknown level", () => {
      const channel = new ConsoleLog();

      // Force an out-of-union level to exercise the switch default branch —
      // not reachable through the typed level shortcuts, but guards against a
      // future level being added without a dedicated case.
      channel.log({
        type: "trace" as unknown as LoggingData["type"],
        module: "diag",
        action: "probe",
        message: "unknown level line",
      });

      const args = consoleSpy.mock.calls[0]!.join(" ");

      expect(args).toContain("[log]");
      expect(args).toContain("[diag]");
      expect(args).toContain("unknown level line");
    });
  });

  describe("context rendering", () => {
    it("does not render context by default", () => {
      const channel = new ConsoleLog();

      channel.log(dataFor({ context: { userId: 42 } }));

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it("renders context as a second line when showContext is enabled", () => {
      const channel = new ConsoleLog({ showContext: true });

      channel.log(dataFor({ context: { userId: 42, role: "admin" } }));

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      const second = consoleSpy.mock.calls[1]!.join(" ");
      expect(second).toContain("userId");
      expect(second).toContain("42");
      expect(second).toContain("role");
    });

    it("does not render an empty context object", () => {
      const channel = new ConsoleLog({ showContext: true });

      channel.log(dataFor({ context: {} }));

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it("does not render a missing context", () => {
      const channel = new ConsoleLog({ showContext: true });

      channel.log(dataFor());

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it("respects a custom contextDepth", () => {
      const channel = new ConsoleLog({ showContext: true, contextDepth: 1 });
      const deep = { a: { b: { c: { d: "hidden" } } } };

      channel.log(dataFor({ context: deep }));

      const second = consoleSpy.mock.calls[1]!.join(" ");
      // depth=1 keeps only the top object's first level rendered as an
      // expansion; deeper nesting collapses to `[Object]`.
      expect(second).not.toContain("hidden");
    });
  });

  describe("filters", () => {
    it("skips a level that is not in the configured levels array", () => {
      const channel = new ConsoleLog({ levels: ["error"] });

      channel.log(dataFor({ type: "info" }));

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("allows a level that is in the configured levels array", () => {
      const channel = new ConsoleLog({ levels: ["error"] });

      channel.log(dataFor({ type: "error" }));

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it("respects a custom filter that returns false", () => {
      const channel = new ConsoleLog({ filter: () => false });

      channel.log(dataFor());

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("respects a custom filter that returns true", () => {
      const channel = new ConsoleLog({ filter: () => true });

      channel.log(dataFor());

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });
  });
});
