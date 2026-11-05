import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createMockBackend } from "./backends/mock";
import { createOps } from "./ops";
import { makeWriteFileTool } from "./tools/write-file";
import type { WorkspaceHooks, WorkspaceOps } from "./contracts";

let jailRoot: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-after-edit-")));
});

function setup(hooks: WorkspaceHooks): WorkspaceOps {
  const backend = createMockBackend({
    [path.join(jailRoot, "a.ts")]: "const a = 1;\n",
    [path.join(jailRoot, "b.ts")]: "const b = 1;\n",
  });

  return createOps(backend, { cwd: jailRoot, hooks });
}

describe("hooks.afterEdit", () => {
  it("returns the hook text on edit_file results, delimited", async () => {
    const afterEdit = vi.fn(async () => "error TS2322: bad");
    const ops = setup({ afterEdit });
    const result = await ops.editFile({ path: "a.ts", oldString: "1", newString: "2" });

    expect(result.diagnostics).toBe("[diagnostics]\nerror TS2322: bad\n[/diagnostics]");
    expect(afterEdit).toHaveBeenCalledWith({ paths: ["a.ts"], tool: "edit_file" });
  });

  it("passes diagnostics through the write_file tool", async () => {
    const ops = setup({ afterEdit: () => "lint: ok-ish" });
    const { data } = await makeWriteFileTool(ops).invoke({ path: "c.ts", content: "x" });

    expect(data?.diagnostics).toContain("lint: ok-ish");
  });

  it("never fails the edit when the hook throws", async () => {
    const ops = setup({
      afterEdit: () => {
        throw new Error("boom");
      },
    });
    const result = await ops.multiEdit({
      path: "a.ts",
      edits: [{ oldString: "1", newString: "3" }],
    });

    expect(result.replacements).toBe(1);
    expect(result.diagnostics).toBe("[diagnostics]\ndiagnostics unavailable\n[/diagnostics]");
  });

  it("reports unavailable on a timeout", async () => {
    const ops = setup({
      afterEdit: () => new Promise<string>(() => undefined),
      afterEditTimeoutMs: 20,
    });
    const result = await ops.writeFile("a.ts", "x");

    expect(result.diagnostics).toContain("diagnostics unavailable");
  });

  it("calls the hook once for a patch that touches several files", async () => {
    const afterEdit = vi.fn(async () => undefined);
    const ops = setup({ afterEdit });
    const patch = [
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1 +1 @@",
      "-const b = 1;",
      "+const b = 2;",
      "",
    ].join("\n");

    const result = await ops.applyPatch?.({ patch });

    expect(result?.diagnostics).toBeUndefined();
    expect(afterEdit).toHaveBeenCalledTimes(1);
    expect(afterEdit).toHaveBeenCalledWith({ paths: ["a.ts", "b.ts"], tool: "apply_patch" });
  });

  it("does not run on a dry run", async () => {
    const afterEdit = vi.fn(async () => "x");
    const ops = setup({ afterEdit });
    const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n";

    await ops.applyPatch?.({ patch, dryRun: true });

    expect(afterEdit).not.toHaveBeenCalled();
  });

  it("cuts over-long output with a marker", async () => {
    const ops = setup({ afterEdit: () => "e".repeat(100), afterEditMaxChars: 10 });
    const result = await ops.writeFile("a.ts", "x");

    expect(result.diagnostics).toContain("eeeeeeeeee\n[diagnostics truncated: showing 10 of 100");
  });
});
