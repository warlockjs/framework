import { describe, expect, it } from "vitest";
import { escapeLogValue } from "./escape-log-value";

describe("escapeLogValue", () => {
  it("turns line breaks and tabs into visible escapes so input cannot forge a log line", () => {
    expect(escapeLogValue("bot\n2026-01-01 [info] admin logged in")).toBe(
      "bot\\n2026-01-01 [info] admin logged in",
    );
    expect(escapeLogValue("a\r\nb\tc")).toBe("a\\r\\nb\\tc");
  });

  it("escapes other control characters and Unicode line separators", () => {
    expect(escapeLogValue("nul\u0000del\u007fc1\u0085ls\u2028ps\u2029")).toBe(
      "nul\\u0000del\\u007fc1\\u0085ls\\u2028ps\\u2029",
    );
  });

  it("removes ANSI terminal escape sequences", () => {
    expect(escapeLogValue("\u001b[31mred\u001b[0m and \u001b[2J\u001bc clear")).toBe(
      "red and  clear",
    );
  });

  it("leaves ordinary text, including non-Latin scripts and emoji, untouched", () => {
    expect(escapeLogValue("Mozilla/5.0 (X11) — مرحبا 👋")).toBe("Mozilla/5.0 (X11) — مرحبا 👋");
  });

  it("stringifies non-string values", () => {
    expect(escapeLogValue(42)).toBe("42");
    expect(escapeLogValue(undefined)).toBe("undefined");
  });

  it("truncates to maxLength and marks the cut", () => {
    expect(escapeLogValue("abcdef", { maxLength: 3 })).toBe("abc…[truncated]");
    expect(escapeLogValue("abc", { maxLength: 3 })).toBe("abc");
  });

  it("stays fast on a long run of escape-like input", () => {
    const input = `\u001b[${"1;".repeat(50_000)}`;
    const started = performance.now();
    escapeLogValue(input);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
