import { randomBytes } from "node:crypto";
import { symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirectoryAsync, removeDirectoryAsync } from "@warlock.js/fs";
import { ai } from "@warlock.js/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceEditError, WorkspacePolicyError } from "./errors";
import { workspace } from "./workspace";
import type { WorkspacePolicy } from "./contracts";

// `node -e ...` is the cross-platform command the exec tests exercise. The
// spawned process does NOT inherit `process.env`, so `node` must be found
// via an explicitly inherited PATH.
const SHELL_POLICY: WorkspacePolicy["shell"] = {
  allow: ["node"],
  inheritEnv: ["PATH"],
};

describe("workspace (integration over the real local backend)", () => {
  let root: string;

  /** Build a writable workspace jailed to the fresh tmp `root`. */
  function makeWorkspace() {
    return workspace({ cwd: root, shell: SHELL_POLICY });
  }

  beforeEach(async () => {
    root = join(tmpdir(), `ws-int-${randomBytes(6).toString("hex")}`);
    await ensureDirectoryAsync(root);
  });

  afterEach(async () => {
    await removeDirectoryAsync(root);
  });

  it("should write a file then read back its content and a stable hash", async () => {
    const ws = makeWorkspace();

    const written = await ws.writeFile("src/index.ts", "export const x = 1;\n");
    expect(written.bytesWritten).toBeGreaterThan(0);

    const read = await ws.readFile("src/index.ts");
    expect(read.content).toContain("export const x = 1;");
    expect(read.totalLines).toBeGreaterThanOrEqual(1);
    // The read hash matches the write hash for the same content.
    expect(read.hash).toBe(written.hash);
  });

  it("should enforce read.maxBytes for both the direct read and the read_file tool", async () => {
    const ws = workspace({ cwd: root, read: { maxBytes: 16, defaultLines: 1 } });
    const raw = "x".repeat(4096);
    await ws.writeFile("owned.txt", raw);

    const direct = await ws.readFile("owned.txt");
    const viaTool = await ws.tools.readFile().invoke({ path: "owned.txt" });

    expect(Buffer.byteLength(direct.content, "utf8")).toBeLessThanOrEqual(16);
    expect(direct.bytesCapped).toBe(true);
    expect(viaTool.error).toBeUndefined();
    expect(viaTool.data).toEqual(direct);
  });

  it("should edit a file when the supplied expectHash is current", async () => {
    const ws = makeWorkspace();
    await ws.writeFile("note.txt", "alpha beta gamma");

    const { hash } = await ws.readFile("note.txt");
    const result = await ws.editFile({
      path: "note.txt",
      oldString: "beta",
      newString: "DELTA",
      expectHash: hash,
    });

    expect(result.replacements).toBe(1);

    const after = await ws.readFile("note.txt");
    expect(after.content).toContain("alpha DELTA gamma");
  });

  it("should reject an edit when the expectHash is stale", async () => {
    const ws = makeWorkspace();
    await ws.writeFile("note.txt", "first content");
    const { hash } = await ws.readFile("note.txt");

    // Move the file underneath the pinned hash.
    await ws.writeFile("note.txt", "second content");

    await expect(
      ws.editFile({
        path: "note.txt",
        oldString: "second",
        newString: "third",
        expectHash: hash,
      }),
    ).rejects.toBeInstanceOf(WorkspaceEditError);
  });

  it("should run a trivial exec and capture stdout + exit code", async () => {
    const ws = makeWorkspace();

    const result = await ws.exec("node -e \"process.stdout.write('pong')\"");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pong");
    expect(result.timedOut).toBe(false);
  });

  it("should reject an exec whose executable is not in the shell allow list", async () => {
    const ws = makeWorkspace();

    await expect(ws.exec("rm -rf /")).rejects.toBeInstanceOf(WorkspacePolicyError);
  });

  it("should grep file contents and report matching lines with paths", async () => {
    const ws = makeWorkspace();
    await ws.writeFile("a.ts", "const TODO = 1;\nconst ok = 2;\n");
    await ws.writeFile("b.ts", "// nothing here\n");

    const result = await ws.grep("TODO");

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.matches.some((match) => match.path === "a.ts" && match.line === 1)).toBe(true);
  });

  it("should glob files within the jail to sorted workspace-relative paths", async () => {
    const ws = makeWorkspace();
    await ws.writeFile("src/one.ts", "1");
    await ws.writeFile("src/two.ts", "2");
    await ws.writeFile("src/note.md", "md");

    const paths = await ws.glob("src/*.ts");

    expect(paths).toEqual(["src/one.ts", "src/two.ts"]);
  });

  it("should report existence and create/remove directories", async () => {
    const ws = makeWorkspace();

    expect(await ws.exists("data")).toBe(false);
    await ws.mkdir("data");
    expect(await ws.exists("data")).toBe(true);

    await ws.writeFile("data/file.txt", "x");
    await ws.remove("data");
    expect(await ws.exists("data")).toBe(false);
  });

  it("should vend every tool except the background-shell pair from tools.all() by default", () => {
    const ws = makeWorkspace();
    const names = ws.tools.all().map((tool) => tool.name);

    expect(names).toEqual([
      "read_file",
      "edit_file",
      "multi_edit",
      "apply_patch",
      "write_file",
      "list_dir",
      "run_shell",
      "run_tests",
      "grep",
      "glob",
      "todo_write",
      "todo_read",
    ]);
  });

  it("should add shell_output and shell_kill to tools.all() when background commands are enabled", () => {
    const ws = workspace({ cwd: root, shell: { ...SHELL_POLICY, background: {} } });
    const names = ws.tools.all().map((tool) => tool.name);

    expect(names).toContain("shell_output");
    expect(names).toContain("shell_kill");
    expect(names.indexOf("shell_output")).toBe(names.indexOf("run_shell") + 1);
  });

  it("should vend only the named subset from tools.pick()", () => {
    const ws = makeWorkspace();
    const names = ws.tools.pick("readFile", "grep", "glob").map((tool) => tool.name);

    expect(names).toEqual(["read_file", "grep", "glob"]);
  });

  it("readonly() should expose only the read-side tools and block writes", async () => {
    const ws = makeWorkspace();
    await ws.writeFile("seed.txt", "seeded");

    const ro = ws.readonly();

    // Only the non-mutating tools are vended.
    expect(ro.tools.all().map((tool) => tool.name)).toEqual([
      "read_file",
      "list_dir",
      "grep",
      "glob",
      "todo_write",
      "todo_read",
    ]);
    // pick() cannot be coaxed into vending a mutating tool.
    expect(ro.tools.pick("writeFile", "readFile").map((tool) => tool.name)).toEqual(["read_file"]);

    // Reads still work through the read-only projection.
    const read = await ro.readFile("seed.txt");
    expect(read.content).toContain("seeded");

    // Mutating direct methods reject.
    await expect(ro.writeFile("x.txt", "nope")).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(ro.exec("node -v")).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(
      ro.multiEdit({ path: "seed.txt", edits: [{ oldString: "seeded", newString: "x" }] }),
    ).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(
      ro.applyPatch({ patch: "--- a/seed.txt\n+++ b/seed.txt\n@@ -1 +1 @@\n-seeded\n+x\n" }),
    ).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(ro.startShell("node -v")).rejects.toBeInstanceOf(WorkspacePolicyError);
  });

  it("shares the todo list with its readonly() and scope() projections", () => {
    const ws = makeWorkspace();

    ws.readonly().writeTodos([{ content: "Plan", status: "in_progress" }]);

    expect(ws.readTodos().todos).toEqual([{ id: "1", content: "Plan", status: "in_progress" }]);
    expect(ws.scope("sub").readTodos().counts.in_progress).toBe(1);
  });

  it("lists a real directory without following a symlink out of the jail", async () => {
    const ws = makeWorkspace();
    const outside = `${root}-outside`;

    await ensureDirectoryAsync(outside);
    await ws.writeFile("src/a.ts", "export {};");
    symlinkSync(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");

    try {
      const listing = await ws.listDir(".", { depth: 3 });

      expect(listing.entries).toEqual([
        { path: "escape", type: "symlink", depth: 1 },
        { path: "src", type: "directory", depth: 1 },
        { path: "src/a.ts", type: "file", size: 10, depth: 2 },
      ]);
    } finally {
      await removeDirectoryAsync(outside);
    }
  });

  it("multiEdit applies all edits to a real file or none", async () => {
    const ws = makeWorkspace();

    await ws.writeFile("a.ts", "const a = 1;\nconst b = 2;\n");

    await expect(
      ws.multiEdit({
        path: "a.ts",
        edits: [
          { oldString: "const a = 1;", newString: "const a = 10;" },
          { oldString: "missing", newString: "x" },
        ],
      }),
    ).rejects.toMatchObject({ type: "not-found", editIndex: 1 });
    expect((await ws.readFile("a.ts")).content).toContain("const a = 1;");

    const result = await ws.multiEdit({
      path: "a.ts",
      edits: [
        { oldString: "const a = 1;", newString: "const a = 10;" },
        { oldString: "const b = 2;", newString: "const b = 20;" },
      ],
    });

    expect(result.replacements).toBe(2);
    expect((await ws.readFile("a.ts")).content).toContain("const b = 20;");
  });

  it("scope(subdir) should jail to the subdirectory", async () => {
    const ws = makeWorkspace();
    await ws.mkdir("packages/api");

    const scoped = ws.scope("packages/api");
    expect(scoped.policy.cwd).toBe(join(root, "packages", "api"));

    // A write through the scoped workspace lands inside the subdir, and is
    // visible to the parent at the prefixed path.
    await scoped.writeFile("handler.ts", "export const h = 1;");
    const fromParent = await ws.readFile("packages/api/handler.ts");
    expect(fromParent.content).toContain("export const h = 1;");

    // The scoped jail rejects an escape back up to the parent root.
    await expect(scoped.readFile("../../seed-outside.txt")).rejects.toBeInstanceOf(
      WorkspacePolicyError,
    );
  });

  it("should register the workspace verb on the shared ai object", () => {
    // `ai.workspace` is natively typed via this package's `declare module`
    // augmentation of the core `Ai` interface — no cast needed.
    expect(typeof ai.workspace).toBe("function");

    const ws = ai.workspace({ cwd: root, shell: SHELL_POLICY });
    expect(ws.policy.cwd).toBe(root);
  });
});
