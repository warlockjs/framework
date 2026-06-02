import { createPathsMatcher, getTsconfig } from "get-tsconfig";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ownResolve, probeFile } from "../../src/dev-server/loader/own-resolver";

/**
 * tsx-4.21 equivalence gate.
 *
 * `.warlock/resolve-golden.jsonl` is captured from a real boot (every
 * resolution tsx performed). For each record we replay the SAME
 * `(specifier, parentURL)` through our resolver and assert:
 *
 * - golden resolved to a project file (our responsibility) → we must
 *   return the exact same `file://` URL.
 * - golden resolved into node_modules / `node:` / via a `file:` specifier
 *   → we return `null` (correctly deferring to Node default at runtime).
 *
 * The fixture lives under `.warlock/` (gitignored). When absent — fresh
 * clone / CI — the suite skips rather than failing.
 */

const projectRoot = process.cwd();
const goldenPath = path.join(projectRoot, ".warlock", "resolve-golden.jsonl");
const hasGolden = existsSync(goldenPath);

const projectUrlPrefix = `file:///${projectRoot.replace(/\\/g, "/")}/`;

function isProjectFile(url: string): boolean {
  return url.startsWith(projectUrlPrefix) && !url.includes("/node_modules/");
}

describe("probeFile", () => {
  const fs = (set: string[]) => (p: string) => set.includes(p);

  it("rewrites .js → .ts before falling back", () => {
    expect(probeFile("/a/b.js", fs(["/a/b.ts"]))).toBe("/a/b.ts");
    expect(probeFile("/a/b.js", fs(["/a/b.tsx"]))).toBe("/a/b.tsx");
  });

  it("prefers exact real extension when present", () => {
    expect(probeFile("/a/b.ts", fs(["/a/b.ts"]))).toBe("/a/b.ts");
  });

  it("appends .ts then .tsx", () => {
    expect(probeFile("/a/c", fs(["/a/c.tsx"]))).toBe("/a/c.tsx");
    expect(probeFile("/a/c", fs(["/a/c.ts", "/a/c.tsx"]))).toBe("/a/c.ts");
  });

  it("falls back to directory index", () => {
    expect(probeFile("/a/d", fs(["/a/d/index.ts"]))).toBe("/a/d/index.ts");
  });

  it("returns null when nothing exists", () => {
    expect(probeFile("/a/missing", fs([]))).toBeNull();
  });
});

describe.skipIf(!hasGolden)("tsx-4.21 equivalence (golden replay)", () => {
  const tsconfig = getTsconfig(projectRoot);
  const matcher = tsconfig ? createPathsMatcher(tsconfig) : null;

  const records = hasGolden
    ? readFileSync(goldenPath, "utf8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line) as {
          specifier: string;
          parentURL: string | undefined;
          url: string;
          format: string | undefined;
        })
    : [];

  // De-dup identical (specifier, parentURL) pairs.
  const seen = new Set<string>();
  const cases = records.filter(r => {
    const k = `${r.specifier}|${r.parentURL ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  it("captured a non-trivial graph", () => {
    expect(cases.length).toBeGreaterThan(1000);
  });

  it("reproduces every project-file resolution exactly", () => {
    const mismatches: string[] = [];

    for (const r of cases) {
      const passthroughSpecifier =
        r.specifier.startsWith("file:") ||
        r.specifier.startsWith("data:") ||
        r.specifier.startsWith("node:");

      const got = ownResolve(r.specifier, r.parentURL, matcher, existsSync);

      if (isProjectFile(r.url) && !passthroughSpecifier) {
        if (got !== r.url) {
          mismatches.push(
            `PROJECT  ${r.specifier}\n  from ${r.parentURL}\n  tsx  ${r.url}\n  ours ${got}`,
          );
        }
      } else if (got !== null && got !== r.url) {
        // Non-project: null is the correct "defer to Node default".
        // A non-null answer is only OK if it matches tsx exactly.
        mismatches.push(
          `DEFER    ${r.specifier}\n  from ${r.parentURL}\n  tsx  ${r.url}\n  ours ${got}`,
        );
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        `${mismatches.length}/${cases.length} resolution mismatches:\n\n` +
          mismatches.slice(0, 40).join("\n\n"),
      );
    }
  });
});
