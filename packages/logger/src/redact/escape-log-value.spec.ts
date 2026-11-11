import { describe, expect, it } from "vitest";
import { escapeLogValue, neutralizeTerminalText } from "./escape-log-value";

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

describe("neutralizeTerminalText", () => {
  it("keeps colour codes, line breaks and tabs", () => {
    const text = "\u001b[1m\u001b[38;5;8mbold\u001b[22m\nnext\tcol";

    expect(neutralizeTerminalText(text)).toBe(text);
  });

  it("removes cursor, screen, title and clipboard sequences and the conceal style", () => {
    expect(
      neutralizeTerminalText(
        "a\u001b[2Jb\u001b[1Ac\u001b]0;title\u0007d\u001b]52;c;eA==\u001b\\e\u001b[8mf\u001bcg",
      ),
    ).toBe("abcdefg");
  });

  it("escapes other control characters and drops a lone ESC", () => {
    expect(neutralizeTerminalText("x\u0000y\u007fz\u001b")).toBe("x\\u0000y\\u007fz");
  });
});
