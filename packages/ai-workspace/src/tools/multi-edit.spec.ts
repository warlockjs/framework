import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hashString } from "@warlock.js/fs";
import { SchemaValidationError, ToolExecutionError } from "@warlock.js/ai";
import { WorkspaceEditError } from "../errors";
import { createMockBackend } from "../backends/mock";
import { createOps } from "../ops";
import { makeMultiEditTool } from "./multi-edit";
import { causeOf } from "./test-support";
import type { WorkspaceBackend, WorkspaceOps } from "../contracts";

let jailRoot: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-multi-edit-")));
});

const FILE = "cart.ts";
const SOURCE = "let total = 0;\nfor (const p of prices) total += p;\nexport { total };\n";

function setup(): { backend: WorkspaceBackend; ops: WorkspaceOps } {
  const backend = createMockBackend({ [path.join(jailRoot, FILE)]: SOURCE });

  return { backend, ops: createOps(backend, { cwd: jailRoot }) };
}

describe("makeMultiEditTool", () => {
  it("is named multi_edit and publishes a JSON Schema", () => {
    const tool = makeMultiEditTool(setup().ops);

    expect(tool.name).toBe("multi_edit");
    expect(
      (tool.input as unknown as { jsonSchema: { required: string[] } }).jsonSchema.required,
    ).toEqual(["path", "edits"]);
  });

  it("applies every edit in order, each against the previous result, in one write", async () => {
    const { backend, ops } = setup();
    const { data, error } = await makeMultiEditTool(ops).invoke({
      path: FILE,
      expectHash: hashString(SOURCE),
      edits: [
        { oldString: "let total = 0;", newString: "let total = 0n;" },
        { oldString: "total += p;", newString: "total += BigInt(p);" },
        // Sees the result of the first edit.
        { oldString: "0n", newString: "BigInt(0)" },
      ],
    });

    const expected =
      "let total = BigInt(0);\nfor (const p of prices) total += BigInt(p);\nexport { total };\n";

    expect(error).toBeUndefined();
    expect(data).toEqual({ path: FILE, edits: 3, replacements: 3, hash: hashString(expected) });
    expect(await backend.readFile(path.join(jailRoot, FILE))).toBe(expected);
  });

  it("counts replaceAll occurrences", async () => {
    const { ops } = setup();
    const { data } = await makeMultiEditTool(ops).invoke({
      path: FILE,
      edits: [{ oldString: "total", newString: "sum", replaceAll: true }],
    });

    expect(data?.replacements).toBe(3);
  });

  it("writes nothing when a later edit fails, and names the failing edit", async () => {
    const { backend, ops } = setup();
    const { data, error } = await makeMultiEditTool(ops).invoke({
      path: FILE,
      edits: [
        { oldString: "let total = 0;", newString: "let total = 1;" },
        { oldString: "does not exist", newString: "x" },
      ],
    });

    expect(data).toBeUndefined();
    expect(error).toBeInstanceOf(ToolExecutionError);

    const cause = causeOf(error);

    expect(cause).toBeInstanceOf(WorkspaceEditError);
    expect(cause).toMatchObject({ type: "not-found", editIndex: 1 });
    expect((cause as Error).message).toMatch(/^Edit 2: .*None of the edits were applied\.$/);
    expect(await backend.readFile(path.join(jailRoot, FILE))).toBe(SOURCE);
  });

  it("rejects a non-unique edit without replaceAll", async () => {
    const { ops } = setup();
    const { error } = await makeMultiEditTool(ops).invoke({
      path: FILE,
      edits: [{ oldString: "total", newString: "sum" }],
    });

    expect(causeOf(error)).toMatchObject({ type: "not-unique", matches: 3, editIndex: 0 });
  });

  it("rejects every edit when expectHash is stale", async () => {
    const { backend, ops } = setup();
    const { error } = await makeMultiEditTool(ops).invoke({
      path: FILE,
      expectHash: "stale",
      edits: [{ oldString: "let", newString: "var" }],
    });

    expect(causeOf(error)).toMatchObject({ type: "stale-hash" });
    expect(await backend.readFile(path.join(jailRoot, FILE))).toBe(SOURCE);
  });

  it("validates its input", async () => {
    const tool = makeMultiEditTool(setup().ops);

    for (const input of [
      { path: FILE, edits: [] },
      { path: FILE, edits: [{ oldString: "", newString: "x" }] },
      { path: FILE, edits: [{ oldString: "a" }] },
      { path: FILE },
      { edits: [{ oldString: "a", newString: "b" }] },
    ]) {
      expect((await tool.invoke(input)).error).toBeInstanceOf(SchemaValidationError);
    }
  });

  it("refuses a path outside the jail", async () => {
    const { error } = await makeMultiEditTool(setup().ops).invoke({
      path: "../escape.ts",
      edits: [{ oldString: "a", newString: "b" }],
    });

    expect(causeOf(error)).toMatchObject({ type: "path-escape" });
  });
});
