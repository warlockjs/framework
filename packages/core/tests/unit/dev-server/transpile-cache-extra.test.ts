import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CACHE_EPOCH,
  cacheKey,
  computeFingerprint,
  TranspileCache,
  type FingerprintParts,
} from "../../../src/dev-server/loader/transpile-cache";

/**
 * Supplements `tests/unit/transpile-cache.test.ts`: covers fingerprint
 * stability on nested option blobs, the NUL-separator anti-collision, the
 * combined age + size GC pass, and tolerant behaviour on a missing cache dir.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "warlock-transpile-extra-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const baseParts: FingerprintParts = {
  esbuildVersion: "0.28.0",
  cacheEpoch: CACHE_EPOCH,
  compilerOptions: { target: "ES2022", paths: { "app/*": ["src/app/*"] } },
};

describe("computeFingerprint — nested options", () => {
  it("is stable when nested object keys are reordered", () => {
    const a = computeFingerprint({
      ...baseParts,
      compilerOptions: { target: "ES2022", paths: { "app/*": ["src/app/*"] } },
    });
    const b = computeFingerprint({
      ...baseParts,
      compilerOptions: { paths: { "app/*": ["src/app/*"] }, target: "ES2022" },
    });

    expect(a).toBe(b);
  });

  it("is sensitive to array element order (arrays are ordered)", () => {
    const a = computeFingerprint({ ...baseParts, compilerOptions: { lib: ["dom", "esnext"] } });
    const b = computeFingerprint({ ...baseParts, compilerOptions: { lib: ["esnext", "dom"] } });

    expect(a).not.toBe(b);
  });

  it("distinguishes null from missing in the option blob", () => {
    const a = computeFingerprint({ ...baseParts, compilerOptions: { jsx: null } });
    const b = computeFingerprint({ ...baseParts, compilerOptions: {} });

    expect(a).not.toBe(b);
  });

  it("produces a 16-char hex fingerprint", () => {
    expect(computeFingerprint(baseParts)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("cacheKey — separator safety", () => {
  it("is a 64-char sha256 hex digest", () => {
    expect(cacheKey("source", "fp")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the source/fingerprint boundary unambiguous for normal inputs", () => {
    // "xy" + "z" must not hash the same as "x" + "yz" — the NUL separator
    // between the two fields prevents that concatenation collision.
    expect(cacheKey("xy", "z")).not.toBe(cacheKey("x", "yz"));
  });
});

describe("TranspileCache.gc — combined bounds", () => {
  it("applies age eviction first, then trims survivors to the size budget", () => {
    const cache = new TranspileCache(dir);
    const big = "x".repeat(1000);

    cache.put("aa1111", { code: big, map: "" });
    cache.put("bb2222", { code: big, map: "" });
    cache.put("cc3333", { code: big, map: "" });

    // aa1111 is ancient → age-evicted; bb/cc are recent but exceed the budget,
    // so the older of the two (bb2222) is trimmed by size.
    const ancient = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(path.join(dir, "aa", "aa1111.js"), ancient, ancient);

    const olderRecent = new Date(Date.now() - 5_000);
    utimesSync(path.join(dir, "bb", "bb2222.js"), olderRecent, olderRecent);

    cache.gc({ maxAgeMs: 60_000, maxBytes: 1100 });

    expect(cache.get("aa1111")).toBeNull();
    expect(cache.get("bb2222")).toBeNull();
    expect(cache.get("cc3333")).not.toBeNull();
  });

  it("keeps everything when survivors already fit the size budget", () => {
    const cache = new TranspileCache(dir);

    cache.put("aa1111", { code: "x;", map: "" });
    cache.put("bb2222", { code: "y;", map: "" });

    cache.gc({ maxAgeMs: 60_000, maxBytes: 10_000 });

    expect(cache.get("aa1111")).not.toBeNull();
    expect(cache.get("bb2222")).not.toBeNull();
  });
});

describe("TranspileCache — resilience", () => {
  it("gc on a never-written cache directory is a no-op, not a throw", () => {
    const cache = new TranspileCache(path.join(dir, "does-not-exist"));

    expect(() => cache.gc({ maxBytes: 1 })).not.toThrow();
  });

  it("clear on a missing directory does not throw", () => {
    const cache = new TranspileCache(path.join(dir, "ghost"));

    expect(() => cache.clear()).not.toThrow();
  });

  it("get after clear misses for a previously stored key", () => {
    const cache = new TranspileCache(dir);

    cache.put("kk0011", { code: "z;", map: "" });
    cache.clear();

    expect(cache.get("kk0011")).toBeNull();
  });
});
