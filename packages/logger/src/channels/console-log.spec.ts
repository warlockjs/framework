import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggingData } from "../types";
import { ConsoleLog } from "./console-log";

const stripAnsi = (value: string) => value.replace(/\[[0-9;]*m/g, "");

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

    it("renders a time-only timestamp (HH:mm:ss.SSS), not the full ISO date", () => {
      const channel = new ConsoleLog();

      channel.log(dataFor());

      const args = consoleSpy.mock.calls[0]!.join(" ");

      // Console is time-only, e.g. (10:22:00.000) — the date + `T`/`Z` are
      // dropped here (persistent channels keep the full ISO timestamp).
      expect(args).toMatch(/\(\d{2}:\d{2}:\d{2}\.\d{3}\)/);
      expect(args).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
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

  describe("tag formatting & alignment", () => {
    const levels = ["debug", "info", "warn", "error", "success", "fatal"] as const;

    it("pads every level tag to a single, aligned column width", () => {
      const widths = levels.map(level => {
        consoleSpy.mockClear();
        new ConsoleLog().log(dataFor({ type: level }));
        const tag = consoleSpy.mock.calls[0]![0] as string;

        return stripAnsi(tag).length;
      });

      // Identical visible width across levels → the timestamp / module / action
      // columns line up vertically in a stream of logs.
      expect(new Set(widths).size).toBe(1);
    });

    it("renders fatal as a background badge, distinct from error", () => {
      const channel = new ConsoleLog();

      consoleSpy.mockClear();
      channel.log(dataFor({ type: "error" }));
      const errorTag = consoleSpy.mock.calls[0]![0] as string;

      consoleSpy.mockClear();
      channel.log(dataFor({ type: "fatal" }));
      const fatalTag = consoleSpy.mock.calls[0]![0] as string;

      // Both carry their level text...
      expect(stripAnsi(fatalTag)).toContain("☠ fatal");
      expect(stripAnsi(errorTag)).toContain("✗ error");

      // ...but only fatal wraps it in a bright-red *background* badge (CSI 101)
      // so it can't be missed in a wall of red `error` lines. When color is off
      // the badge degrades to plain text, so we only assert codes when the
      // output actually carries ANSI (derived from the error tag itself).
      const colorOn = errorTag !== stripAnsi(errorTag);

      if (colorOn) {
        expect(fatalTag).toContain("101m");
        expect(errorTag).not.toContain("101m");
      }
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
