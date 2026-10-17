import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildVitestArguments, readTestCommandOptions, resolveProjectVitest } from "./test.command";

describe("buildVitestArguments", () => {
  it("runs everything once by default", () => {
    expect(buildVitestArguments({ filters: [] })).toEqual(["run"]);
  });

  it("--changed runs the tests affected by uncommitted changes, passing when there are none", () => {
    expect(buildVitestArguments({ filters: [], changed: true })).toEqual([
      "run",
      "--changed",
      "--passWithNoTests",
    ]);
  });

  it("--since names the git ref for --changed", () => {
    expect(
      buildVitestArguments({ filters: ["src/app/posts"], changed: true, since: "main" }),
    ).toEqual(["run", "src/app/posts", "--changed", "main", "--passWithNoTests"]);
  });

  it("--related uses vitest related, once", () => {
    expect(
      buildVitestArguments({
        filters: [],
        related: ["src/app/posts/services/create-post.service.ts"],
      }),
    ).toEqual([
      "related",
      "src/app/posts/services/create-post.service.ts",
      "--run",
      "--passWithNoTests",
    ]);
  });

  it("--watch drops run, --json picks the JSON reporter, -t filters by name", () => {
    expect(
      buildVitestArguments({ filters: [], watch: true, json: true, testNamePattern: "anonymous" }),
    ).toEqual(["--testNamePattern", "anonymous", "--reporter=json"]);
  });
});

describe("readTestCommandOptions", () => {
  it("splits --related on commas and keeps positional filters", () => {
    expect(
      readTestCommandOptions({
        args: ["src/app/posts"],
        options: { related: "a.ts, b.ts", changed: true, t: "creates" },
      }),
    ).toEqual({
      filters: ["src/app/posts"],
      changed: true,
      since: undefined,
      related: ["a.ts", "b.ts"],
      watch: false,
      json: false,
      testNamePattern: "creates",
    });
  });
});

describe("resolveProjectVitest", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("resolves the project's own vitest entry from its package.json bin", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "warlock-test-command-"));
    await writeFile(path.join(root, "package.json"), "{}");
    await mkdir(path.join(root, "node_modules", "vitest"), { recursive: true });
    await writeFile(
      path.join(root, "node_modules", "vitest", "package.json"),
      JSON.stringify({ name: "vitest", bin: { vitest: "./vitest.mjs" } }),
    );
    await writeFile(path.join(root, "node_modules", "vitest", "vitest.mjs"), "");

    expect(resolveProjectVitest(root)).toBe(
      path.join(root, "node_modules", "vitest", "vitest.mjs"),
    );
  });

  it("says how to install vitest when the project has none", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "warlock-test-command-"));
    await writeFile(path.join(root, "package.json"), "{}");

    // Resolution walks up from the project; a parent folder with its own
    // node_modules must not stand in, so the lookup is made to miss.
    const missing = () => {
      throw Object.assign(new Error("Cannot find module"), { code: "MODULE_NOT_FOUND" });
    };

    expect(() => resolveProjectVitest(root as string, missing)).toThrow("warlock add test");
  });
});
