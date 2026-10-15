import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hashString } from "@warlock.js/fs";
import { WorkspaceEditError } from "../errors";
import { createMockBackend } from "../backends/mock";
import { createOps } from "../ops";
import { makeEditFileTool } from "./edit-file";
import { causeOf } from "./test-support";
import type { WorkspaceBackend, WorkspaceOps } from "../contracts";

// Real tmp jail root so the jail resolver and the mock backend agree on
// the absolute key (see read-file.spec.ts for the rationale).
let jailRoot: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-edit-")));
});

const FILE = "a.ts";
const SOURCE = "const a = 1;\nconst b = 2;\nconst a2 = 1;\n";

/** Absolute key for a workspace-relative path, for seeding the mock. */
function abs(relativePath: string): string {
  return path.join(jailRoot, relativePath);
}

/** A mock backend seeded with the source file, plus ops over it. */
function setup(): { backend: WorkspaceBackend; ops: WorkspaceOps } {
  const backend = createMockBackend({ [abs(FILE)]: SOURCE });

  return { backend, ops: createOps(backend, { cwd: jailRoot }) };
}

/** Build ops over an empty mock backend. */
function emptyOps(): WorkspaceOps {
  return createOps(createMockBackend(), { cwd: jailRoot });
}

describe("makeEditFileTool", () => {
  it("uses the default tool name and a description", () => {
    const editTool = makeEditFileTool(emptyOps());

    expect(editTool.name).toBe("edit_file");
    expect(editTool.description.length).toBeGreaterThan(0);
  });

  it("honors a custom name override", () => {
    const editTool = makeEditFileTool(emptyOps(), { name: "patch" });

    expect(editTool.name).toBe("patch");
  });

  it("returns data on a successful unique edit", async () => {
    const { backend, ops } = setup();
    const editTool = makeEditFileTool(ops);

    const result = await editTool.invoke({
      path: FILE,
      oldString: "const b = 2;",
      newString: "const b = 3;",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.replacements).toBe(1);
    expect(result.data?.path).toBe(FILE);
    expect(typeof result.data?.hash).toBe("string");
    expect(await backend.readFile(abs(FILE))).toContain("const b = 3;");
  });

  it("replaces every occurrence with replaceAll and reports the count", async () => {
    const editTool = makeEditFileTool(setup().ops);

    const result = await editTool.invoke({
      path: FILE,
      oldString: "= 1;",
      newString: "= 9;",
      replaceAll: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.replacements).toBe(2);
  });

  it("returns { error } (not a throw) on a non-unique edit without replaceAll", async () => {
    const editTool = makeEditFileTool(setup().ops);

    const result = await editTool.invoke({
      path: FILE,
      oldString: "= 1;",
      newString: "= 9;",
    });

    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
    // ops throws WorkspaceEditError("not-unique"); tool() wraps it, so the
    // original surfaces as the wrapped error's cause.
    expect(causeOf(result.error)).toBeInstanceOf(WorkspaceEditError);
    expect((causeOf(result.error) as WorkspaceEditError).type).toBe("not-unique");
  });

  it("returns { error } on a stale expectHash", async () => {
    const editTool = makeEditFileTool(setup().ops);

    const result = await editTool.invoke({
      path: FILE,
      oldString: "const b = 2;",
      newString: "const b = 3;",
      expectHash: "deadbeef",
    });

    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(causeOf(result.error)).toBeInstanceOf(WorkspaceEditError);
    expect((causeOf(result.error) as WorkspaceEditError).type).toBe("stale-hash");
  });

  it("accepts a matching expectHash", async () => {
    const editTool = makeEditFileTool(setup().ops);

    const result = await editTool.invoke({
      path: FILE,
      oldString: "const b = 2;",
      newString: "const b = 3;",
      expectHash: hashString(SOURCE),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.replacements).toBe(1);
  });

  it("returns { error } when oldString is not found", async () => {
    const editTool = makeEditFileTool(setup().ops);

    const result = await editTool.invoke({
      path: FILE,
      oldString: "nonexistent",
      newString: "x",
    });

    expect(result.data).toBeUndefined();
    expect((causeOf(result.error) as WorkspaceEditError).type).toBe("not-found");
  });
});
