import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createMockBackend } from "./backends/mock";
import { WorkspaceEditError } from "./errors";
import { createOps } from "./ops";
import type { WorkspaceBackend, WorkspaceOps, WorkspacePolicy } from "./contracts";

let jailRoot: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-edit-match-")));
});

function setup(
  files: Record<string, string>,
  extra?: Partial<WorkspacePolicy>,
): { backend: WorkspaceBackend; ops: WorkspaceOps } {
  const seeded: Record<string, string> = {};

  for (const [name, content] of Object.entries(files)) {
    seeded[path.join(jailRoot, name)] = content;
  }

  const backend = createMockBackend(seeded);

  return { backend, ops: createOps(backend, { cwd: jailRoot, ...extra }) };
}

async function missOf(promise: Promise<unknown>): Promise<WorkspaceEditError> {
  try {
    await promise;
  } catch (error) {
    return error as WorkspaceEditError;
  }

  throw new Error("expected the edit to fail");
}

const read = (backend: WorkspaceBackend, name: string) =>
  backend.readFile(path.join(jailRoot, name));

describe("tiered edit matching", () => {
  it("reports no tier for an exact match", async () => {
    const { ops } = setup({ "a.ts": "const a = 1;\n" });
    const result = await ops.editFile({ path: "a.ts", oldString: "a = 1", newString: "a = 2" });

    expect(result.matchTier).toBeUndefined();
    expect(result.replacements).toBe(1);
  });

  it("matches curly quotes in the file against straight quotes (tier unicode)", async () => {
    const { backend, ops } = setup({ "a.md": "He said “hello” to it.\n" });
    const result = await ops.editFile({
      path: "a.md",
      oldString: 'said "hello" to',
      newString: 'said "bye" to',
    });

    expect(result.matchTier).toBe("unicode");
    expect(await read(backend, "a.md")).toBe('He said "bye" to it.\n');
  });

  it("keeps CRLF when the model sends LF text", async () => {
    const { backend, ops } = setup({ "a.ts": "one\r\ntwo\r\nthree\r\n" });
    const result = await ops.editFile({
      path: "a.ts",
      oldString: "one\ntwo",
      newString: "uno\ndos\ndos-b",
    });

    expect(result.matchTier).toBeUndefined();
    expect(await read(backend, "a.ts")).toBe("uno\r\ndos\r\ndos-b\r\nthree\r\n");
  });

  it("keeps CRLF for a single-line match with a multi-line replacement", async () => {
    const { backend, ops } = setup({ "a.ts": "one\r\ntwo\r\n" });

    await ops.editFile({ path: "a.ts", oldString: "one", newString: "a\nb" });

    expect(await read(backend, "a.ts")).toBe("a\r\nb\r\ntwo\r\n");
  });

  it("can force line endings", async () => {
    const { backend, ops } = setup({ "a.ts": "one\ntwo\n" }, { edit: { lineEndings: "crlf" } });

    await ops.editFile({ path: "a.ts", oldString: "one", newString: "a\nb" });

    expect(await read(backend, "a.ts")).toBe("a\r\nb\ntwo\n");
  });

  it("matches lines that differ in trailing whitespace (tier whitespace)", async () => {
    const { backend, ops } = setup({ "a.ts": "if (x) {  \n  go();\t\n}\n" });
    const result = await ops.editFile({
      path: "a.ts",
      oldString: "if (x) {\n  go();\n}",
      newString: "if (y) {\n  stop();\n}",
    });

    expect(result.matchTier).toBe("whitespace");
    expect(await read(backend, "a.ts")).toBe("if (y) {\n  stop();\n}\n");
  });

  it("refuses a loose match with two candidates and writes nothing, even with replaceAll", async () => {
    const source = "go();  \nmid\ngo();\t\n";
    const { backend, ops } = setup({ "a.ts": source });
    const failure = await missOf(
      ops.editFile({ path: "a.ts", oldString: "go();\n", newString: "stop();\n", replaceAll: true }),
    );

    expect(failure).toBeInstanceOf(WorkspaceEditError);
    expect(failure).toMatchObject({ type: "not-unique", matches: 2 });
    expect(await read(backend, "a.ts")).toBe(source);
  });

  it("does not apply a loose tier when matching is exact", async () => {
    const { ops } = setup({ "a.md": "“hi”\n" }, { edit: { matching: "exact" } });

    await expect(
      ops.editFile({ path: "a.md", oldString: '"hi"', newString: "x" }),
    ).rejects.toMatchObject({ type: "not-found" });
  });

  it("applies a multi-edit through the tiers and reports the loosest one", async () => {
    const { backend, ops } = setup({ "a.ts": "a = 1;  \nb = “2”;\n" });
    const result = await ops.multiEdit({
      path: "a.ts",
      edits: [
        { oldString: "a = 1;\n", newString: "a = 10;\n" },
        { oldString: 'b = "2"', newString: "b = 20" },
      ],
    });

    expect(result.matchTier).toBe("whitespace");
    expect(await read(backend, "a.ts")).toBe("a = 10;\nb = 20;\n");
  });
});

describe("miss hints", () => {
  const SOURCE = "function total(items) {\n  return items.length;\n}\n";

  it("shows the closest lines, capped at 12 lines of 200 characters", async () => {
    const long = `const value = ${"x".repeat(400)};`;
    const body = Array.from({ length: 30 }, (_, index) => `  step${index}();`).join("\n");
    const { ops } = setup({ "a.ts": `${long}\nfunction run() {\n${body}\n}\n` });
    const error = await missOf(
      ops.editFile({
        path: "a.ts",
        oldString: `const value = ${"y".repeat(5)};\n${body.replace(/step/g, "stap")}`,
        newString: "z",
      }),
    );

    expect(error.type).toBe("not-found");
    expect(error.hint).toBeDefined();

    const shown = (error.hint ?? "").split("\n").slice(1);

    expect(shown.length).toBeLessThanOrEqual(12);
    expect(shown.every((line) => line.length <= 200 + 8)).toBe(true);
  });

  it("points at the closest text for a near miss", async () => {
    const { ops } = setup({ "a.ts": SOURCE });
    const error = await missOf(
      ops.editFile({ path: "a.ts", oldString: "  return items.size;", newString: "x" }),
    );

    expect(error.hint).toContain("2:   return items.length;");
    expect(error.message).toContain("Closest text in the file");
  });

  it("says when newString is already present", async () => {
    const { ops } = setup({ "a.ts": SOURCE });
    const error = await missOf(
      ops.editFile({ path: "a.ts", oldString: "nope()", newString: "return items.length;" }),
    );

    expect(error.hint).toContain("already present");
  });

  it("is switched off with missHintLines: 0", async () => {
    const { ops } = setup({ "a.ts": SOURCE }, { edit: { missHintLines: 0 } });
    const error = await missOf(
      ops.editFile({ path: "a.ts", oldString: "  return items.size;", newString: "x" }),
    );

    expect(error.hint).toBeUndefined();
  });

  it("gives no hint for a path the jail refuses", async () => {
    const { ops } = setup({ ".env": "SECRET=1\n" }, { denyPaths: [".env*"] });

    await expect(
      ops.editFile({ path: ".env", oldString: "SECRET=2", newString: "x" }),
    ).rejects.toMatchObject({ type: "path-escape" });
  });
});
