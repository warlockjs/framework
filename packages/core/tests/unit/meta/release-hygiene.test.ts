import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Name } from "../../../src/cli/commands/generate/utils/name-parser";
import {
  crudModelStub,
  migrationStub,
  modelStub,
} from "../../../src/cli/commands/generate/templates/stubs";

/**
 * Tier-0 release-hygiene guards for `@warlock.js/core`, shipped as Vitest
 * checks because this monorepo has no `.github/workflows` CI. They fail the
 * unit suite the moment a release-blocking invariant is violated, so a bad
 * version/changelog pairing or a regressed generator import never reaches a
 * published build.
 */

const packageRoot = path.resolve(__dirname, "../../..");

/** A `## x.y.z` changelog heading with an optional ` - YYYY-MM-DD` date. */
type ChangelogHeading = {
  version: string;
  major: number;
  minor: number;
  patch: number;
  /** The date suffix verbatim (`2026-06-21`), or `undefined` when undated. */
  date?: string;
};

/**
 * Parse the top-most `## x.y.z[ - YYYY-MM-DD]` heading out of a CHANGELOG body.
 * Returns `undefined` when no version heading is present.
 */
function parseTopHeading(changelog: string): ChangelogHeading | undefined {
  const match = changelog.match(
    /^##\s+(\d+)\.(\d+)\.(\d+)(?:\s*[-–]\s*(\d{4}-\d{2}-\d{2}))?\s*$/m,
  );

  if (!match) {
    return undefined;
  }

  const [, major, minor, patch, date] = match;

  return {
    version: `${major}.${minor}.${patch}`,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    date,
  };
}

/** Parse a `x.y.z` semver string into its numeric components. */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) {
    throw new Error(`package.json version "${version}" is not a plain x.y.z semver`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Whether `heading` is exactly one patch or one minor ahead of `pkg` — the only
 * shapes a staged (not-yet-released) next version may legitimately take.
 */
function isExactlyOneAhead(
  heading: { major: number; minor: number; patch: number },
  pkg: { major: number; minor: number; patch: number },
): boolean {
  if (heading.major !== pkg.major) {
    return false;
  }

  const oneMinorAhead =
    heading.minor === pkg.minor + 1 && heading.patch === 0;
  const onePatchAhead =
    heading.minor === pkg.minor && heading.patch === pkg.patch + 1;

  return oneMinorAhead || onePatchAhead;
}

describe("release hygiene: version ↔ changelog invariant", () => {
  const pkgVersion: string = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  ).version;
  const changelog = readFileSync(path.join(packageRoot, "CHANGELOG.md"), "utf8");
  const heading = parseTopHeading(changelog);

  it("CHANGELOG.md has a parseable top-most version heading", () => {
    expect(heading, "no `## x.y.z` heading found at the top of CHANGELOG.md").toBeDefined();
  });

  it("the top changelog heading matches package.json or is a staged next version", () => {
    expect(heading).toBeDefined();
    const top = heading as ChangelogHeading;
    const pkg = parseVersion(pkgVersion);

    if (top.version === pkgVersion) {
      // Released version — equal versions are always valid regardless of date.
      return;
    }

    // Not equal: the only legitimate shape is a staged next version that is
    // exactly one patch/minor ahead AND still undated (no release date stamped).
    expect(
      isExactlyOneAhead(top, pkg),
      `top changelog version ${top.version} is neither equal to package.json ${pkgVersion} nor exactly one patch/minor ahead`,
    ).toBe(true);

    expect(
      top.date,
      `staged next version ${top.version} carries a release date (${top.date ?? ""}) — a not-yet-released version must stay undated (audit F9)`,
    ).toBeUndefined();
  });

  it("a version ahead of package.json never carries a hard past date (audit F9)", () => {
    expect(heading).toBeDefined();
    const top = heading as ChangelogHeading;
    const pkg = parseVersion(pkgVersion);

    const isAhead =
      top.major > pkg.major ||
      (top.major === pkg.major && top.minor > pkg.minor) ||
      (top.major === pkg.major &&
        top.minor === pkg.minor &&
        top.patch > pkg.patch);

    // A future (ahead-of-published) version stamped with a concrete date is the
    // exact F9 footgun: it claims to have shipped on a date while package.json
    // still trails it. Such a heading must remain undated until the release.
    if (isAhead) {
      expect(
        top.date,
        `version ${top.version} is ahead of published ${pkgVersion} but is dated ${top.date ?? ""} — drop the date until it ships`,
      ).toBeUndefined();
    }
  });
});

describe("release hygiene: generator-stub import sources (audit F2)", () => {
  const product = new Name("product");

  it("modelStub imports v/Infer from seal and Model from cascade — never from core", () => {
    const output = modelStub(product);

    expect(output).toContain('from "@warlock.js/seal"');
    expect(output).toMatch(/import \{[^}]*\bv\b[^}]*\} from "@warlock\.js\/seal"/);
    expect(output).toMatch(/import \{[^}]*\bInfer\b[^}]*\} from "@warlock\.js\/seal"/);
    expect(output).toMatch(/import \{[^}]*\bModel\b[^}]*\} from "@warlock\.js\/cascade"/);

    // The F2 regression: v / Infer were once imported from core, which exports
    // neither, so every generated model failed to compile.
    expect(output).not.toContain('from "@warlock.js/core"');
  });

  it("crudModelStub imports v/Infer from seal and Model/RegisterModel from cascade — never from core", () => {
    const output = crudModelStub(product);

    expect(output).toMatch(/import \{[^}]*\bv\b[^}]*\} from "@warlock\.js\/seal"/);
    expect(output).toMatch(/import \{[^}]*\bInfer\b[^}]*\} from "@warlock\.js\/seal"/);
    expect(output).toMatch(
      /import \{[^}]*\bModel\b[^}]*\bRegisterModel\b[^}]*\} from "@warlock\.js\/cascade"/,
    );

    expect(output).not.toContain('v } from "@warlock.js/core"');
    expect(output).not.toContain('{ type Infer, v } from "@warlock.js/core"');
  });

  it("migrationStub imports Migration from cascade, not core", () => {
    const output = migrationStub(product);

    expect(output).toMatch(/import \{[^}]*\bMigration\b[^}]*\} from "@warlock\.js\/cascade"/);
    expect(output).not.toContain('Migration } from "@warlock.js/core"');
  });

  it("no stub ever sources v or Infer from @warlock.js/core (core re-exports neither)", () => {
    // A broad guard across the stubs most likely to regress: any line that
    // imports `v` or `Infer` must resolve to seal, never to core.
    const stubs: Record<string, string> = {
      modelStub: modelStub(product),
      crudModelStub: crudModelStub(product),
    };

    for (const [stubName, source] of Object.entries(stubs)) {
      const lines = source.split("\n");

      for (const line of lines) {
        const isImport = line.trimStart().startsWith("import ");
        const fromCore = line.includes('from "@warlock.js/core"');

        if (isImport && fromCore) {
          expect(
            /\b(v|Infer)\b/.test(line),
            `${stubName} imports v/Infer from @warlock.js/core: ${line.trim()}`,
          ).toBe(false);
        }
      }
    }
  });
});
