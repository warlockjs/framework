import { describe, expect, it } from "vitest";
import { WorkspaceEditError } from "../errors";
import { applyHunks } from "./apply-hunks";
import { parsePatch } from "./parse-patch";

const apply = (content: string, patch: string): string => {
  const [file] = parsePatch(patch);

  return applyHunks(content, file?.hunks ?? [], "f.txt");
};

describe("parsePatch", () => {
  it("parses a plain unified diff", () => {
    const [file] = parsePatch(
      "--- a.txt\t2026-01-01\n+++ a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n",
    );

    expect(file).toMatchObject({ kind: "modify", oldPath: "a.txt", newPath: "a.txt" });
    expect(file?.hunks[0]?.lines).toEqual([
      { op: " ", text: "one" },
      { op: "-", text: "two" },
      { op: "+", text: "TWO" },
    ]);
  });

  it("parses git-style create, delete and rename sections", () => {
    const files = parsePatch(
      [
        "diff --git a/new.txt b/new.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.txt",
        "@@ -0,0 +1 @@",
        "+hello",
        "diff --git a/old.txt b/old.txt",
        "deleted file mode 100644",
        "--- a/old.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
        "diff --git a/x.txt b/y.txt",
        "similarity index 100%",
        "rename from x.txt",
        "rename to y.txt",
        "",
      ].join("\n"),
    );

    expect(files.map((file) => [file.kind, file.oldPath, file.newPath])).toEqual([
      ["create", null, "new.txt"],
      ["delete", "old.txt", null],
      ["rename", "x.txt", "y.txt"],
    ]);
  });

  it("refuses binary patches with a binary-file error", () => {
    const text = "diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n";

    expect(() => parsePatch(text)).toThrowError(/binary/);
    try {
      parsePatch(text);
    } catch (error) {
      expect((error as WorkspaceEditError).type).toBe("binary-file");
    }

    expect(() => parsePatch("diff --git a/i b/i\nGIT binary patch\nliteral 1\n")).toThrowError(
      /binary/,
    );
  });

  it("rejects non-diffs, truncated hunks, copies and the apply_patch envelope", () => {
    expect(() => parsePatch("just some words")).toThrowError(/no file changes/);
    expect(() => parsePatch("--- a\n+++ a\n@@ -1,3 +1,3 @@\n x\n")).toThrowError(/truncated/);
    expect(() => parsePatch("diff --git a/a b/b\ncopy from a\ncopy to b\n")).toThrowError(/Copies/);
    expect(() => parsePatch("*** Begin Patch\n*** Update File: a\n")).toThrowError(/Begin Patch/);
  });
});

describe("applyHunks", () => {
  it("applies a hunk and tolerates line drift", () => {
    const content = "x\ny\nz\none\ntwo\nthree\n";

    expect(apply(content, "--- a\n+++ a\n@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n")).toBe(
      "x\ny\nz\none\n2\nthree\n",
    );
  });

  it("keeps CRLF files CRLF, including added lines", () => {
    const out = apply("a\r\nb\r\nc\r\n", "--- a\n+++ a\n@@ -1,3 +1,4 @@\n a\n b\n+new\n c\n");

    expect(out).toBe("a\r\nb\r\nnew\r\nc\r\n");
  });

  it("accepts a CRLF-wrapped patch against an LF file", () => {
    expect(apply("a\nb\n", "--- a\r\n+++ a\r\n@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+B\r\n")).toBe(
      "a\nB\n",
    );
  });

  it("handles the no-newline-at-end marker", () => {
    expect(
      apply(
        "a\nb",
        "--- a\n+++ a\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n",
      ),
    ).toBe("a\nc");
    expect(
      apply("a\nb", "--- a\n+++ a\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n"),
    ).toBe("a\nc\n");
  });

  it("builds a file from nothing and inserts at the top", () => {
    expect(apply("", "--- /dev/null\n+++ b\n@@ -0,0 +1,2 @@\n+a\n+b\n")).toBe("a\nb\n");
    expect(apply("tail\n", "--- a\n+++ a\n@@ -0,0 +1 @@\n+head\n")).toBe("head\ntail\n");
  });

  it("reports the failing hunk when context is missing", () => {
    try {
      apply("a\nb\n", "--- a\n+++ a\n@@ -1 +1 @@\n-zzz\n+y\n");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceEditError);
      expect((error as WorkspaceEditError).type).toBe("hunk-failed");
      expect((error as WorkspaceEditError).hunkIndex).toBe(0);
    }
  });
});
