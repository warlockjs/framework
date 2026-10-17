import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createMockBackend } from "../backends/mock";
import { createOps } from "../ops";
import { makeListDirTool } from "./list-dir";
import { causeOf } from "./test-support";
import type { WorkspacePolicy } from "../contracts";

let jailRoot: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-list-dir-")));
});

/** A mock tree: src (2 levels), node_modules, .git, .env. */
function setup(policy: Partial<WorkspacePolicy> = {}) {
  const files: Record<string, string> = {
    "package.json": "{}",
    ".env": "SECRET=1",
    "src/index.ts": "export {};",
    "src/lib/util.ts": "export const u = 1;",
    "src/lib/deep/x.ts": "x",
    "node_modules/pkg/index.js": "",
    ".git/config": "",
  };
  const backend = createMockBackend(
    Object.fromEntries(
      Object.entries(files).map(([file, content]) => [path.join(jailRoot, file), content]),
    ),
  );

  return createOps(backend, { cwd: jailRoot, ...policy });
}

describe("makeListDirTool", () => {
  it("lists direct children with types and file sizes, ignoring node_modules and .git", async () => {
    const { data, error } = await makeListDirTool(setup()).invoke({});

    expect(error).toBeUndefined();
    expect(data).toEqual({
      path: ".",
      entries: [
        { path: ".env", type: "file", size: 8, depth: 1 },
        { path: "package.json", type: "file", size: 2, depth: 1 },
        { path: "src", type: "directory", depth: 1 },
      ],
      truncated: false,
    });
  });

  it("goes depth levels deep, breadth-first, and hides denyPaths", async () => {
    const { data } = await makeListDirTool(setup({ denyPaths: [".env*", "src/lib/deep"] })).invoke({
      depth: 3,
    });

    expect(data?.entries.map((entry) => `${entry.depth}:${entry.path}`)).toEqual([
      "1:package.json",
      "1:src",
      "2:src/index.ts",
      "2:src/lib",
      "3:src/lib/util.ts",
    ]);
  });

  it("lists a subdirectory and honours extra ignore globs", async () => {
    const { data } = await makeListDirTool(setup()).invoke({
      path: "src",
      depth: 2,
      ignore: ["**/util.ts"],
    });

    expect(data?.path).toBe("src");
    expect(data?.entries.map((entry) => entry.path)).toEqual([
      "src/index.ts",
      "src/lib",
      "src/lib/deep",
    ]);
  });

  it("caps depth at list.maxDepth and entries at list.maxEntries", async () => {
    const capped = await makeListDirTool(setup({ list: { maxDepth: 1 } })).invoke({ depth: 5 });

    expect(capped.data?.entries.every((entry) => entry.depth === 1)).toBe(true);

    const truncated = await makeListDirTool(setup({ list: { maxEntries: 2 } })).invoke({
      depth: 3,
    });

    expect(truncated.data?.entries).toHaveLength(2);
    expect(truncated.data?.truncated).toBe(true);
  });

  it("replaces the default ignore list with list.ignore", async () => {
    const { data } = await makeListDirTool(setup({ list: { ignore: ["src"] } })).invoke({});

    expect(data?.entries.map((entry) => entry.path)).toEqual([
      ".env",
      ".git",
      "node_modules",
      "package.json",
    ]);
  });

  it("refuses a directory outside the jail", async () => {
    const { error } = await makeListDirTool(setup()).invoke({ path: ".." });

    expect(causeOf(error)).toMatchObject({ type: "path-escape" });
  });
});
