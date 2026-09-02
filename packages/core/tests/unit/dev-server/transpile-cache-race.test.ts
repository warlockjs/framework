import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  renameSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  fsMock.renameSync.mockImplementation(actual.renameSync);

  return {
    ...actual,
    renameSync: fsMock.renameSync,
  };
});

const { TranspileCache } = await import("../../../src/dev-server/loader/transpile-cache");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "warlock-transpile-race-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("TranspileCache.put — concurrent atomic commits", () => {
  it("accepts an identical destination when Windows rejects the losing rename", () => {
    const cache = new TranspileCache(dir);
    const entry = { code: "export const value = 1;", map: "" };

    cache.put("aa1111", entry);
    fsMock.renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });

    expect(() => cache.put("aa1111", entry)).not.toThrow();
    expect(cache.get("aa1111")).toEqual(entry);
    expect(readdirSync(path.join(dir, "aa"))).toEqual(["aa1111.js"]);
  });

  it("does not hide EPERM when no complete destination won the race", () => {
    const cache = new TranspileCache(dir);

    fsMock.renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });

    expect(() => cache.put("bb2222", { code: "broken", map: "" })).toThrow(
      "operation not permitted",
    );
    expect(readdirSync(path.join(dir, "bb"))).toEqual([]);
  });

  it("does not accept a conflicting destination as a successful commit", () => {
    const cache = new TranspileCache(dir);

    cache.put("cc3333", { code: "original", map: "" });
    fsMock.renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });

    expect(() => cache.put("cc3333", { code: "different", map: "" })).toThrow(
      "operation not permitted",
    );
    expect(cache.get("cc3333")).toEqual({ code: "original", map: "" });
    expect(readdirSync(path.join(dir, "cc"))).toEqual(["cc3333.js"]);
  });
});
