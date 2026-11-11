import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalBackend } from "../backends/local";
import { createMockBackend } from "../backends/mock";
import type { WorkspaceBackend, WorkspacePolicy } from "../contracts";
import { createOps } from "../ops";
import { staticGlobPrefix } from "./walk";

const ROOT = "/srv/app";

/** A mock-backed ops whose backend records every directory it is asked to list. */
function spiedOps(files: Record<string, string>, policy: Partial<WorkspacePolicy> = {}) {
  const mock = createMockBackend(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [`${ROOT}/${name}`, content]),
    ),
  );
  const listed: string[] = [];
  const backend: WorkspaceBackend = {
    readFile: (absPath) => mock.readFile(absPath),
    writeFile: (absPath, content) => mock.writeFile(absPath, content),
    exists: (absPath) => mock.exists(absPath),
    mkdir: (absPath) => mock.mkdir(absPath),
    remove: (absPath) => mock.remove(absPath),
    list: async (absDir) => {
      listed.push(absDir);

      return mock.list(absDir);
    },
    realpath: (absPath) => mock.realpath(absPath),
    exec: (command, opts) => mock.exec(command, opts),
    stat: (absPath) => mock.stat!(absPath),
  };

  return { ops: createOps(backend, { cwd: ROOT, ...policy }), listed };
}

describe("staticGlobPrefix", () => {
  it("keeps the leading wildcard-free folders and never the last segment", () => {
    expect(staticGlobPrefix("qa/**/*.mjs")).toBe("qa");
    expect(staticGlobPrefix("src/a/b.ts")).toBe("src/a");
    expect(staticGlobPrefix("**/*.ts")).toBe("");
    expect(staticGlobPrefix("src/*/x/*.ts")).toBe("src");
    expect(staticGlobPrefix("../x/*.ts")).toBe("");
  });
});

describe("glob and grep walk", () => {
  it("skips node_modules and .git without ever listing inside them", async () => {
    const files: Record<string, string> = { "src/a.ts": "export const a = 1;", ".git/HEAD": "ref" };

    for (let index = 0; index < 30_000; index++) {
      files[`node_modules/pkg${index % 50}/f${index}.ts`] = "x";
    }

    const { ops, listed } = spiedOps(files);

    expect(await ops.glob("src/**/*.ts")).toEqual(["src/a.ts"]);
    expect(await ops.glob("**/*.ts")).toEqual(["src/a.ts"]);
    expect(listed.some((dir) => dir.includes("node_modules/") || dir.includes(".git"))).toBe(false);
  });

  it("starts glob at the static prefix", async () => {
    const { ops, listed } = spiedOps({ "src/a.ts": "a", "docs/b.ts": "b" });

    expect(await ops.glob("src/*.ts")).toEqual(["src/a.ts"]);
    expect(listed).toEqual([`${ROOT}/src`]);
  });

  it("starts grep at the folder of its glob and reads nothing outside it", async () => {
    const { ops, listed } = spiedOps({ "src/a.ts": "needle", "docs/b.md": "needle" });
    const result = await ops.grep("needle", { glob: "src/**" });

    expect(result.matches.map((match) => match.path)).toEqual(["src/a.ts"]);
    expect(listed).toEqual([`${ROOT}/src`]);
  });

  it("searches a skipped folder named by the pattern prefix", async () => {
    const { ops } = spiedOps({ "node_modules/pkg/package.json": "{}", "a.json": "{}" });

    expect(await ops.glob("node_modules/pkg/*.json")).toEqual(["node_modules/pkg/package.json"]);
  });

  it("honours skipDirs settings, including nested folders", async () => {
    const files = { "a/node_modules/x.ts": "x", "a/y.ts": "y", ".git/z.ts": "z" };

    expect(await spiedOps(files).ops.glob("**/*.ts")).toEqual(["a/y.ts"]);
    expect(
      (await spiedOps(files, { search: { skipDirs: [".git"] } }).ops.glob("**/*.ts")).sort(),
    ).toEqual(["a/node_modules/x.ts", "a/y.ts"]);
    expect(
      (await spiedOps(files, { search: { skipDirs: [] } }).ops.glob("**/*.ts")).sort(),
    ).toEqual([".git/z.ts", "a/node_modules/x.ts", "a/y.ts"]);
  });

  it("honours .gitignore files, and ignores them when gitignore is off", async () => {
    const files = {
      ".gitignore": "dist/\n*.log\n!keep.log\n/root-only.ts\n",
      "src/.gitignore": "gen/\n",
      "dist/out.ts": "o",
      "src/gen/g.ts": "g",
      "src/real.ts": "r",
      "src/dist/inner.ts": "i",
      "a.log": "l",
      "keep.log": "k",
      "root-only.ts": "r",
      "sub/root-only.ts": "r",
    };

    expect(await spiedOps(files).ops.glob("**")).toEqual([
      ".gitignore",
      "keep.log",
      "src/.gitignore",
      "src/real.ts",
      "sub/root-only.ts",
    ]);
    expect((await spiedOps(files, { search: { gitignore: false } }).ops.glob("**")).length).toBe(
      10,
    );
  });

  it("walks a repository whose .gitignore holds a backtracking-shaped line", async () => {
    // As a regular expression this line needs exponential time on the long
    // name below; the glob matcher checks it in one pass.
    const longName = `${"a".repeat(100)}.ts`;
    const files = {
      ".gitignore": `${"*?".repeat(20)}Z\n${"*".repeat(600)}\n`,
      [`src/${longName}`]: "x",
    };

    expect(await spiedOps(files).ops.glob("src/*.ts")).toEqual([`src/${longName}`]);
  });

  it("applies a parent .gitignore when the search starts in a subfolder", async () => {
    const files = { ".gitignore": "*.tmp\n", "src/a.tmp": "t", "src/a.ts": "a" };

    expect(await spiedOps(files).ops.glob("src/*")).toEqual(["src/a.ts"]);
  });

  it("keeps denyPaths: files and directories are dropped before they are read", async () => {
    const { ops, listed } = spiedOps(
      { "secret/key.pem": "k", "src/a.ts": "a", "src/.env": "e" },
      { denyPaths: ["secret/**", "**/.env"] },
    );

    expect(await ops.glob("**")).toEqual(["src/a.ts"]);
    expect(listed).not.toContain(`${ROOT}/secret`);
    expect((await ops.grep(".")).matches.map((match) => match.path)).toEqual(["src/a.ts"]);
  });

  it("returns nothing when the pattern prefix is denied or missing", async () => {
    const { ops } = spiedOps({ "secret/key.pem": "k" }, { denyPaths: ["secret/**"] });

    expect(await ops.glob("secret/*.pem")).toEqual([]);
    expect(await ops.glob("nope/*.pem")).toEqual([]);
  });

  it("stops at an aborted signal", async () => {
    const { ops } = spiedOps({ "a/b.ts": "x" });
    const controller = new AbortController();

    controller.abort();

    await expect(ops.glob("**", { signal: controller.signal })).rejects.toThrow();
    await expect(ops.grep("x", { signal: controller.signal })).rejects.toThrow();
  });

  it("stops at maxFiles and reports it", async () => {
    const files: Record<string, string> = {};

    for (let index = 0; index < 20; index++) {
      files[`f${index}.ts`] = "needle";
    }

    const { ops } = spiedOps(files, { search: { maxFiles: 5 } });
    const globbed = await ops.globResult!("*.ts");
    const grepped = await ops.grep("needle");

    expect(globbed.paths).toHaveLength(5);
    expect(globbed.truncated).toBe(true);
    expect(globbed.maxFilesReached).toBe(true);
    expect(grepped.total).toBe(5);
    expect(grepped.maxFilesReached).toBe(true);
    expect((await spiedOps(files).ops.globResult!("*.ts")).maxFilesReached).toBeUndefined();
  });

  it("works over a backend with no stat and no typed listing", async () => {
    const mock = createMockBackend({
      [`${ROOT}/src/a.ts`]: "a",
      [`${ROOT}/node_modules/p/i.ts`]: "i",
    });
    const bare: WorkspaceBackend = {
      readFile: (p) => mock.readFile(p),
      writeFile: (p, c) => mock.writeFile(p, c),
      exists: (p) => mock.exists(p),
      mkdir: (p) => mock.mkdir(p),
      remove: (p) => mock.remove(p),
      list: (p) => mock.list(p),
      realpath: (p) => mock.realpath(p),
      exec: (c, o) => mock.exec(c, o),
    };
    const ops = createOps(bare, { cwd: ROOT });

    expect(await ops.glob("**/*.ts")).toEqual(["src/a.ts"]);
  });
});

describe("glob and grep on the local backend", () => {
  let dir = "";

  afterEach(async () => {
    if (dir !== "") {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the typed listing, skips node_modules and never follows symlinks out of the jail", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "ws-search-"));

    dir = base;
    const jail = path.join(base, "jail");
    const outside = path.join(base, "outside");

    await mkdir(path.join(jail, "src"), { recursive: true });
    await mkdir(path.join(jail, "node_modules", "p"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(jail, "src", "a.ts"), "needle");
    await writeFile(path.join(jail, "node_modules", "p", "i.ts"), "needle");
    await writeFile(path.join(outside, "leak.ts"), "needle");
    await symlink(outside, path.join(jail, "src", "linkdir"));
    await symlink(path.join(outside, "leak.ts"), path.join(jail, "src", "leak.ts"));
    await symlink(path.join(jail, "src", "a.ts"), path.join(jail, "src", "inner.ts"));

    const ops = createOps(createLocalBackend(), { cwd: jail });

    expect(await ops.glob("**/*.ts")).toEqual(["src/a.ts", "src/inner.ts"]);
    expect((await ops.grep("needle")).matches.map((match) => match.path)).toEqual([
      "src/a.ts",
      "src/inner.ts",
    ]);
  });
});
