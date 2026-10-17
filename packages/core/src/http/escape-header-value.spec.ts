import { describe, expect, it } from "vitest";
import { escapeHeaderValue } from "./escape-header-value";

describe("escapeHeaderValue", () => {
  it("removes CR/LF so a value cannot split the header", () => {
    expect(escapeHeaderValue("report\r\nSet-Cookie: session=stolen")).toBe(
      "reportSet-Cookie: session=stolen",
    );
  });

  it("removes NUL and other control characters but keeps tabs", () => {
    expect(escapeHeaderValue("a\u0000b\u0007c\u007fd\te")).toBe("abcd\te");
  });

  it("replaces characters Node refuses in header values", () => {
    expect(escapeHeaderValue("تقرير-2026 📈")).toBe("?????-2026 ?");
    expect(escapeHeaderValue("café")).toBe("café");
  });

  it("stringifies and trims", () => {
    expect(escapeHeaderValue(42)).toBe("42");
    expect(escapeHeaderValue("  value \n")).toBe("value");
  });

  it("produces values Node accepts as headers", async () => {
    const { validateHeaderValue } = await import("node:http");
    for (const input of ["a\r\nb", "x\u0000y", "ok", "日本", " line"]) {
      expect(() => validateHeaderValue("x-test", escapeHeaderValue(input))).not.toThrow();
    }
  });
});
