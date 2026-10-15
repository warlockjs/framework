import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  areSetsEqual,
  getCertainFilesFromDirectory,
  getFilesFromDirectory,
} from "../../../src/dev-server/utils";

describe("areSetsEqual", () => {
  it("is true for two empty sets", () => {
    expect(areSetsEqual(new Set(), new Set())).toBe(true);
  });

  it("is true for sets with the same members regardless of insertion order", () => {
    expect(areSetsEqual(new Set([1, 2, 3]), new Set([3, 1, 2]))).toBe(true);
  });

  it("is false when sizes differ", () => {
    expect(areSetsEqual(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false);
  });

  it("is false when a member differs at equal size", () => {
    expect(areSetsEqual(new Set([1, 2, 3]), new Set([1, 2, 4]))).toBe(false);
  });

  it("works with string members", () => {
    expect(areSetsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(areSetsEqual(new Set(["a", "b"]), new Set(["a", "c"]))).toBe(false);
  });
});

describe("getFilesFromDirectory", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "warlock-utils-glob-"));
    mkdirSync(path.join(dir, "nested"), { recursive: true });

    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;");
    writeFileSync(path.join(dir, "b.tsx"), "export const b = 2;");
    writeFileSync(path.join(dir, "skip.js"), "module.exports = {};");
    writeFileSync(path.join(dir, "nested", "c.ts"), "export const c = 3;");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns only .ts/.tsx files as normalized absolute paths", async () => {
    const files = await getFilesFromDirectory(dir);

    expect(files.every((file) => /\.(ts|tsx)$/.test(file))).toBe(true);
    expect(files.some((file) => file.endsWith("skip.js"))).toBe(false);
  });

  it("recurses into subdirectories", async () => {
    const files = await getFilesFromDirectory(dir);

    expect(files.some((file) => file.endsWith("nested/c.ts"))).toBe(true);
  });

  it("emits forward-slash paths even on Windows", async () => {
    const files = await getFilesFromDirectory(dir);

    expect(files.every((file) => !file.includes("\\"))).toBe(true);
  });
});

describe("getCertainFilesFromDirectory", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "warlock-utils-certain-"));

    writeFileSync(path.join(dir, "main.ts"), "");
    writeFileSync(path.join(dir, "routes.ts"), "");
    writeFileSync(path.join(dir, "service.ts"), "");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches a single named file", async () => {
    const files = await getCertainFilesFromDirectory(dir, ["main"]);

    expect(files).toHaveLength(1);
    expect(files[0].endsWith("main.ts")).toBe(true);
  });

  it("matches several named files via an alternation", async () => {
    const files = await getCertainFilesFromDirectory(dir, ["main", "routes"]);
    const names = files.map((file) => path.basename(file)).sort();

    expect(names).toEqual(["main.ts", "routes.ts"]);
  });
});
