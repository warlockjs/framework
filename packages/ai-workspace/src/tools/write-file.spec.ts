import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hashString } from "@warlock.js/fs";
import { createMockBackend } from "../backends/mock";
import { createOps } from "../ops";
import { makeWriteFileTool } from "./write-file";
import type { WorkspaceBackend, WorkspaceOps } from "../contracts";

// Real tmp jail root so the jail resolver and the mock backend agree on
// the absolute key (see read-file.spec.ts for the rationale).
let jailRoot: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-write-")));
});

/** Absolute key for a workspace-relative path, for seeding the mock. */
function abs(relativePath: string): string {
  return path.join(jailRoot, relativePath);
}

/** Build ops over a mock backend seeded with the given files. */
function ops(files: Record<string, string> = {}): WorkspaceOps {
  return createOps(createMockBackend(files), { cwd: jailRoot });
}

describe("makeWriteFileTool", () => {
  it("uses the default tool name and a description", () => {
    const writeTool = makeWriteFileTool(ops());

    expect(writeTool.name).toBe("write_file");
    expect(writeTool.description.length).toBeGreaterThan(0);
  });

  it("honors a custom name override", () => {
    const writeTool = makeWriteFileTool(ops(), { name: "put" });

    expect(writeTool.name).toBe("put");
  });

  it("returns data (path, bytesWritten, hash) and persists the content", async () => {
    const backend: WorkspaceBackend = createMockBackend();
    const writeTool = makeWriteFileTool(createOps(backend, { cwd: jailRoot }));

    const result = await writeTool.invoke({ path: "src/new.ts", content: "hello" });

    expect(result.error).toBeUndefined();
    expect(result.data?.path).toBe("src/new.ts");
    expect(result.data?.bytesWritten).toBe(5);
    expect(result.data?.hash).toBe(hashString("hello"));
    expect(await backend.readFile(abs("src/new.ts"))).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const writeTool = makeWriteFileTool(ops({ [abs("f.ts")]: "old" }));

    const result = await writeTool.invoke({ path: "f.ts", content: "new" });

    expect(result.error).toBeUndefined();
    expect(result.data?.bytesWritten).toBe(3);
  });

  it("returns { error } when the input fails schema validation", async () => {
    const writeTool = makeWriteFileTool(ops());

    const result = await writeTool.invoke({ path: "f.ts" });

    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it("returns { error } (never throws) when the path escapes the jail", async () => {
    const writeTool = makeWriteFileTool(ops());

    const result = await writeTool.invoke({ path: "../escape.ts", content: "x" });

    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});
