import path from "node:path";
import { describe, expect, it } from "vitest";
import { FsPathEscapeError, isPathInside } from "../src";
import { normalizeConfinedPath } from "../src/confined-path";

function escapeReason(input: string, platform: NodeJS.Platform): string | undefined {
  try {
    normalizeConfinedPath(input, "/root", platform);
  } catch (error) {
    expect(error).toBeInstanceOf(FsPathEscapeError);
    return (error as FsPathEscapeError).reason;
  }

  return undefined;
}

describe("normalizeConfinedPath — POSIX", () => {
  it("normalises separators, dots and inner `..`", () => {
    expect(normalizeConfinedPath("", "/root", "linux")).toEqual([]);
    expect(normalizeConfinedPath(".", "/root", "linux")).toEqual([]);
    expect(normalizeConfinedPath("./a//b/", "/root", "linux")).toEqual(["a", "b"]);
    expect(normalizeConfinedPath("a/../b", "/root", "linux")).toEqual(["b"]);
    expect(normalizeConfinedPath("a\\b", "/root", "linux")).toEqual(["a\\b"]);
    expect(normalizeConfinedPath("..data", "/root", "linux")).toEqual(["..data"]);
  });

  it("refuses escapes with a reason", () => {
    expect(escapeReason("/etc/passwd", "linux")).toBe("absolute");
    expect(escapeReason("..", "linux")).toBe("parent-traversal");
    expect(escapeReason("../x", "linux")).toBe("parent-traversal");
    expect(escapeReason("a/../../x", "linux")).toBe("parent-traversal");
    expect(escapeReason("a\0b", "linux")).toBe("invalid");
  });

  it("carries the input and the root on the error", () => {
    expect(() => normalizeConfinedPath("../x", "/root", "linux")).toThrow(
      expect.objectContaining({ type: "path-escape", path: "../x", root: "/root" }),
    );
  });
});

describe("normalizeConfinedPath — Windows rules", () => {
  it("treats `\\` as a separator", () => {
    expect(normalizeConfinedPath("a\\b/c", "C:\\root", "win32")).toEqual(["a", "b", "c"]);
  });

  it("refuses absolute, drive-relative and UNC paths", () => {
    expect(escapeReason("C:\\Windows", "win32")).toBe("absolute");
    expect(escapeReason("C:secret", "win32")).toBe("absolute");
    expect(escapeReason("\\\\server\\share", "win32")).toBe("absolute");
    expect(escapeReason("\\\\?\\C:\\x", "win32")).toBe("absolute");
    expect(escapeReason("\\x", "win32")).toBe("absolute");
  });

  it("refuses `..` climbs written with backslashes", () => {
    expect(escapeReason("a\\..\\..\\b", "win32")).toBe("parent-traversal");
  });

  it("refuses streams, device names and names Win32 would rewrite", () => {
    expect(escapeReason("file.txt:hidden", "win32")).toBe("invalid");
    expect(escapeReason("CON", "win32")).toBe("invalid");
    expect(escapeReason("logs/nul.txt", "win32")).toBe("invalid");
    expect(escapeReason("com1", "win32")).toBe("invalid");
    expect(escapeReason("secret.txt.", "win32")).toBe("invalid");
    expect(escapeReason("dir ", "win32")).toBe("invalid");
    expect(escapeReason("...", "win32")).toBe("invalid");
    expect(normalizeConfinedPath("console.log", "C:\\root", "win32")).toEqual(["console.log"]);
  });
});

describe("isPathInside", () => {
  const root = path.resolve("/srv/app");

  it("compares segments, not string prefixes", () => {
    expect(isPathInside(root, root)).toBe(true);
    expect(isPathInside(path.join(root, "a", "b"), root)).toBe(true);
    expect(isPathInside(path.join(root, "..data"), root)).toBe(true);
    expect(isPathInside(path.resolve("/srv/app-evil"), root)).toBe(false);
    expect(isPathInside(path.resolve("/srv"), root)).toBe(false);
  });
});
