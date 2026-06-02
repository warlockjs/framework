import { mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CACHE_EPOCH,
  cacheKey,
  computeFingerprint,
  TranspileCache,
  type FingerprintParts,
} from "../../src/dev-server/loader/transpile-cache";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "warlock-transpile-cache-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const baseParts: FingerprintParts = {
  esbuildVersion: "0.28.0",
  cacheEpoch: CACHE_EPOCH,
  compilerOptions: { target: "ES2022", useDefineForClassFields: false },
};

describe("computeFingerprint", () => {
  it("is stable for identical inputs", () => {
    expect(computeFingerprint(baseParts)).toBe(computeFingerprint(baseParts));
  });

  it("is order-independent for option keys", () => {
    const a = computeFingerprint({
      ...baseParts,
      compilerOptions: { target: "ES2022", useDefineForClassFields: false },
    });
    const b = computeFingerprint({
      ...baseParts,
      compilerOptions: { useDefineForClassFields: false, target: "ES2022" },
    });
    expect(a).toBe(b);
  });

  it("changes when esbuild version changes", () => {
    const a = computeFingerprint(baseParts);
    const b = computeFingerprint({ ...baseParts, esbuildVersion: "0.29.0" });
    expect(a).not.toBe(b);
  });

  it("changes when the cache epoch changes", () => {
    const a = computeFingerprint(baseParts);
    const b = computeFingerprint({ ...baseParts, cacheEpoch: CACHE_EPOCH + 1 });
    expect(a).not.toBe(b);
  });

  it("changes when compiler options change", () => {
    const a = computeFingerprint(baseParts);
    const b = computeFingerprint({
      ...baseParts,
      compilerOptions: { target: "ES2020" },
    });
    expect(a).not.toBe(b);
  });
});

describe("cacheKey", () => {
  it("is stable for identical source + fingerprint", () => {
    const fp = computeFingerprint(baseParts);
    expect(cacheKey("const a = 1;", fp)).toBe(cacheKey("const a = 1;", fp));
  });

  it("differs when source differs", () => {
    const fp = computeFingerprint(baseParts);
    expect(cacheKey("const a = 1;", fp)).not.toBe(cacheKey("const a = 2;", fp));
  });

  it("differs when fingerprint differs (option drift invalidates)", () => {
    const src = "export const x = 1;";
    const fpA = computeFingerprint(baseParts);
    const fpB = computeFingerprint({ ...baseParts, cacheEpoch: 99 });
    expect(cacheKey(src, fpA)).not.toBe(cacheKey(src, fpB));
  });

  it("has no concatenation collision between source and fingerprint", () => {
    // "ab" + "c" must not collide with "a" + "bc"
    expect(cacheKey("ab", "c")).not.toBe(cacheKey("a", "bc"));
  });
});

describe("TranspileCache get/put", () => {
  it("returns null on a miss", () => {
    const cache = new TranspileCache(dir);
    expect(cache.get("deadbeef")).toBeNull();
  });

  it("round-trips code and map", () => {
    const cache = new TranspileCache(dir);
    cache.put("abc123", { code: "export const a=1;", map: '{"version":3}' });

    const hit = cache.get("abc123");
    expect(hit).not.toBeNull();
    expect(hit!.code).toBe("export const a=1;");
    expect(hit!.map).toBe('{"version":3}');
  });

  it("round-trips code with an empty map", () => {
    const cache = new TranspileCache(dir);
    cache.put("nomap1", { code: "1+1;", map: "" });

    const hit = cache.get("nomap1");
    expect(hit).not.toBeNull();
    expect(hit!.code).toBe("1+1;");
    expect(hit!.map).toBe("");
  });

  it("shards by the first two key chars", () => {
    const cache = new TranspileCache(dir);
    cache.put("ff00aa", { code: "x;", map: "" });
    expect(readdirSync(dir)).toContain("ff");
  });

  it("overwrites an existing entry on re-put", () => {
    const cache = new TranspileCache(dir);
    cache.put("k1", { code: "old;", map: "" });
    cache.put("k1", { code: "new;", map: "" });
    expect(cache.get("k1")!.code).toBe("new;");
  });
});

describe("TranspileCache labeled entries", () => {
  it("round-trips when a label is supplied", () => {
    const cache = new TranspileCache(dir);
    cache.put("ab12", { code: "labeled;", map: "" }, "app-users-user");
    expect(cache.get("ab12", "app-users-user")!.code).toBe("labeled;");
  });

  it("writes the label into the filename, keyed by hash", () => {
    const cache = new TranspileCache(dir);
    cache.put("ab34cd", { code: "x;", map: "" }, "vectors-utils-locales");
    expect(readdirSync(path.join(dir, "ab"))).toContain(
      "vectors-utils-locales.ab34cd.js",
    );
  });

  it("label is part of the on-disk name: wrong/absent label misses", () => {
    const cache = new TranspileCache(dir);
    cache.put("ff99", { code: "x;", map: "" }, "slug-a");
    expect(cache.get("ff99")).toBeNull();
    expect(cache.get("ff99", "slug-b")).toBeNull();
    expect(cache.get("ff99", "slug-a")).not.toBeNull();
  });

  it("still shards by the hash prefix, not the label", () => {
    const cache = new TranspileCache(dir);
    cache.put("cc77", { code: "x;", map: "" }, "some-slug");
    expect(readdirSync(dir)).toContain("cc");
  });

  it("gc still evicts labeled entries by size", () => {
    const cache = new TranspileCache(dir);
    cache.put("aa00", { code: "a".repeat(5000), map: "" }, "big-one");
    cache.gc({ maxBytes: 100 });
    expect(cache.get("aa00", "big-one")).toBeNull();
  });
});

describe("TranspileCache gc", () => {
  it("is a no-op with no bounds set", () => {
    const cache = new TranspileCache(dir);
    cache.put("k1", { code: "x;", map: "" });
    cache.gc();
    expect(cache.get("k1")).not.toBeNull();
  });

  it("evicts age-expired entries", () => {
    const cache = new TranspileCache(dir);
    cache.put("oldkey", { code: "x;".repeat(10), map: "" });

    // Backdate the entry well past the age bound.
    const codePath = path.join(dir, "ol", "oldkey.js");
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(codePath, old, old);

    cache.gc({ maxAgeMs: 60_000 });
    expect(cache.get("oldkey")).toBeNull();
  });

  it("keeps fresh entries when only age bound is set", () => {
    const cache = new TranspileCache(dir);
    cache.put("freshk", { code: "x;", map: "" });
    cache.gc({ maxAgeMs: 60_000 });
    expect(cache.get("freshk")).not.toBeNull();
  });

  it("trims to the size budget, evicting oldest first", () => {
    const cache = new TranspileCache(dir);
    const big = "a".repeat(1000);

    cache.put("aa1111", { code: big, map: "" });
    cache.put("bb2222", { code: big, map: "" });
    cache.put("cc3333", { code: big, map: "" });

    // Make aa1111 the oldest by mtime.
    const oldest = new Date(Date.now() - 10_000);
    utimesSync(path.join(dir, "aa", "aa1111.js"), oldest, oldest);

    // Budget fits ~2 of the 3 entries → the oldest must go.
    cache.gc({ maxBytes: 2200 });

    expect(cache.get("aa1111")).toBeNull();
    expect(cache.get("bb2222")).not.toBeNull();
    expect(cache.get("cc3333")).not.toBeNull();
  });

  it("counts the map sidecar toward the size budget", () => {
    const cache = new TranspileCache(dir);
    cache.put("withmap", { code: "x;", map: "m".repeat(5000) });
    cache.gc({ maxBytes: 100 });
    expect(cache.get("withmap")).toBeNull();
  });
});

describe("TranspileCache clear", () => {
  it("removes the whole cache directory", () => {
    const cache = new TranspileCache(dir);
    cache.put("k1", { code: "x;", map: "" });
    cache.clear();
    expect(cache.get("k1")).toBeNull();
  });
});
