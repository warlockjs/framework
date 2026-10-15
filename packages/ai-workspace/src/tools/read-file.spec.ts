import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hashString } from "@warlock.js/fs";
import { createMockBackend } from "../backends/mock";
import { createOps } from "../ops";
import { makeReadFileTool } from "./read-file";
import type { WorkspaceOps } from "../contracts";

// Use a REAL tmp jail root (as the package's ops.spec.ts does) so the
// `node:path`-based jail resolver and the mock backend's canonicalization
// agree on the absolute key — a POSIX-style `/srv/app` would diverge from
// the Windows drive-relative path the resolver produces.
let jailRoot: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-read-")));
});

/** Absolute key for a workspace-relative path, for seeding the mock. */
function abs(relativePath: string): string {
  return path.join(jailRoot, relativePath);
}

/** Build ops over a mock backend seeded with the given files. */
function ops(files: Record<string, string> = {}): WorkspaceOps {
  return createOps(createMockBackend(files), { cwd: jailRoot });
}

describe("makeReadFileTool", () => {
  it("uses the default tool name and a description", () => {
    const readTool = makeReadFileTool(ops());

    expect(readTool.name).toBe("read_file");
    expect(readTool.description.length).toBeGreaterThan(0);
  });

  it("honors a custom name override", () => {
    const readTool = makeReadFileTool(ops(), { name: "view" });

    expect(readTool.name).toBe("view");
  });

  it("returns data (content, hash, totalLines) on a successful read", async () => {
    const content = "line1\nline2\nline3\n";
    const readTool = makeReadFileTool(ops({ [abs("src/index.ts")]: content }));

    const result = await readTool.invoke({ path: "src/index.ts" });

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data?.hash).toBe(hashString(content));
    expect(result.data?.totalLines).toBe(4); // trailing newline ⇒ 4th empty line
    expect(result.data?.content).toContain("line1");
    expect(result.data?.startLine).toBe(1);
  });

  it("reports a windowed read as truncated with the right range", async () => {
    const content = "a\nb\nc\nd\ne\n";
    const readTool = makeReadFileTool(ops({ [abs("f.ts")]: content }));

    const result = await readTool.invoke({ path: "f.ts", startLine: 2, limit: 2 });

    expect(result.error).toBeUndefined();
    expect(result.data?.startLine).toBe(2);
    expect(result.data?.endLine).toBe(3);
    expect(result.data?.truncated).toBe(true);
  });

  it("returns { error } when the input fails schema validation", async () => {
    const readTool = makeReadFileTool(ops());

    const result = await readTool.invoke({ path: 123 });

    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it("returns { error } (never throws) when the path escapes the jail", async () => {
    const readTool = makeReadFileTool(ops());

    const result = await readTool.invoke({ path: "../../etc/passwd" });

    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});
