import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createLocalBackend } from "../backends/local";
import { createMockBackend } from "../backends/mock";
import type { WorkspaceBackend } from "../contracts";
import { WorkspaceEditError, WorkspacePolicyError } from "../errors";
import { createOps } from "../ops";
import { makeApplyPatchTool } from "../tools/apply-patch";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-patch-")));
});

const read = (name: string): string => readFileSync(path.join(root, name), "utf8");
const seed = (name: string, content: string): void => {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), content);
};
const ops = () => createOps(createLocalBackend(), { cwd: root });

describe("ops.applyPatch", () => {
  it("modifies, creates, deletes and renames in one patch", async () => {
    seed("a.txt", "one\ntwo\n");
    seed("gone.txt", "bye\n");
    seed("old.txt", "keep\n");

    const result = await ops().applyPatch({
      patch: [
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,2 +1,2 @@",
        " one",
        "-two",
        "+TWO",
        "--- /dev/null",
        "+++ b/sub/new.txt",
        "@@ -0,0 +1 @@",
        "+fresh",
        "--- a/gone.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
        "diff --git a/old.txt b/moved.txt",
        "rename from old.txt",
        "rename to moved.txt",
        "",
      ].join("\n"),
    });

    expect(result.files.map((file) => [file.action, file.path])).toEqual([
      ["modified", "a.txt"],
      ["created", "sub/new.txt"],
      ["deleted", "gone.txt"],
      ["renamed", "moved.txt"],
    ]);
    expect(read("a.txt")).toBe("one\nTWO\n");
    expect(read("sub/new.txt")).toBe("fresh\n");
    expect(read("moved.txt")).toBe("keep\n");
    expect(existsSync(path.join(root, "gone.txt"))).toBe(false);
    expect(existsSync(path.join(root, "old.txt"))).toBe(false);
  });

  it("is atomic: a failing second file leaves the first untouched", async () => {
    seed("a.txt", "one\n");
    seed("b.txt", "two\n");

    await expect(
      ops().applyPatch({
        patch:
          "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+ONE\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-nope\n+x\n",
      }),
    ).rejects.toMatchObject({ type: "hunk-failed", path: "b.txt", hunkIndex: 0 });

    expect(read("a.txt")).toBe("one\n");
    expect(read("b.txt")).toBe("two\n");
  });

  it("rolls back already-written files when a write fails part-way", async () => {
    seed("a.txt", "one\n");
    seed("b.txt", "two\n");

    const real = createLocalBackend();
    const failing: WorkspaceBackend = Object.create(real, {
      writeFile: {
        value: async (absPath: string, content: string) => {
          if (absPath.endsWith("b.txt")) {
            throw new Error("disk full");
          }

          return real.writeFile(absPath, content);
        },
      },
    });

    await expect(
      createOps(failing, { cwd: root }).applyPatch({
        patch:
          "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+ONE\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-two\n+TWO\n",
      }),
    ).rejects.toThrowError(/rolled back/);

    expect(read("a.txt")).toBe("one\n");
    expect(read("b.txt")).toBe("two\n");
  });

  it("dryRun checks without writing", async () => {
    seed("a.txt", "one\n");

    const result = await ops().applyPatch({
      patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+ONE\n",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(read("a.txt")).toBe("one\n");
  });

  it("refuses to create over an existing file and to change a missing one", async () => {
    seed("a.txt", "one\n");

    await expect(
      ops().applyPatch({ patch: "--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+x\n" }),
    ).rejects.toMatchObject({ type: "file-exists" });
    await expect(
      ops().applyPatch({ patch: "--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-x\n+y\n" }),
    ).rejects.toMatchObject({ type: "file-missing" });
  });

  it("refuses a binary patch and a binary target file", async () => {
    seed("blob.bin", "ab\0cd\n");

    await expect(
      ops().applyPatch({
        patch: "diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n",
      }),
    ).rejects.toMatchObject({ type: "binary-file" });
    await expect(
      ops().applyPatch({ patch: "--- a/blob.bin\n+++ b/blob.bin\n@@ -1 +1 @@\n-ab\n+x\n" }),
    ).rejects.toMatchObject({ type: "binary-file" });
  });

  it("refuses paths that escape through .. and absolute paths", async () => {
    await expect(
      ops().applyPatch({ patch: "--- /dev/null\n+++ b/../escape.txt\n@@ -0,0 +1 @@\n+x\n" }),
    ).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(
      ops().applyPatch({ patch: "--- /dev/null\n+++ /tmp/ws-escape-abs.txt\n@@ -0,0 +1 @@\n+x\n" }),
    ).rejects.toBeInstanceOf(WorkspacePolicyError);
  });

  it("refuses paths that escape through a symlink", async () => {
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-outside-")));

    writeFileSync(path.join(outside, "secret.txt"), "top\n");

    try {
      symlinkSync(outside, path.join(root, "link"), "dir");
    } catch {
      return; // symlinks unavailable (unprivileged Windows)
    }

    await expect(
      ops().applyPatch({
        patch: "--- a/link/secret.txt\n+++ b/link/secret.txt\n@@ -1 +1 @@\n-top\n+pwned\n",
      }),
    ).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(
      ops().applyPatch({ patch: "--- /dev/null\n+++ b/link/new.txt\n@@ -0,0 +1 @@\n+x\n" }),
    ).rejects.toBeInstanceOf(WorkspacePolicyError);
    expect(readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("top\n");
    expect(existsSync(path.join(outside, "new.txt"))).toBe(false);
  });

  it("applies later file patches on top of earlier ones (swap via rename)", async () => {
    seed("a.txt", "A\n");
    seed("b.txt", "B\n");

    await ops().applyPatch({
      patch: [
        "diff --git a/a.txt b/tmp.txt",
        "rename from a.txt",
        "rename to tmp.txt",
        "diff --git a/b.txt b/a.txt",
        "rename from b.txt",
        "rename to a.txt",
        "diff --git a/tmp.txt b/b.txt",
        "rename from tmp.txt",
        "rename to b.txt",
        "",
      ].join("\n"),
    });

    expect(read("a.txt")).toBe("B\n");
    expect(read("b.txt")).toBe("A\n");
  });

  it("works over the mock backend and through the tool", async () => {
    const backend = createMockBackend({ [path.join(root, "m.txt")]: "x\n" });
    const tool = makeApplyPatchTool(createOps(backend, { cwd: root }));
    const { data, error } = await tool.invoke({
      patch: "--- a/m.txt\n+++ b/m.txt\n@@ -1 +1 @@\n-x\n+y\n",
    });

    expect(error).toBeUndefined();
    expect(data?.files[0]?.action).toBe("modified");
    expect(await backend.readFile(path.join(root, "m.txt"))).toBe("y\n");
    expect(tool.name).toBe("apply_patch");

    const bad = await tool.invoke({ patch: "nonsense" });

    expect(bad.error).toBeDefined();
    expect(WorkspaceEditError).toBeDefined();
  });
});
