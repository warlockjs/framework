import { existsSync, readFileSync } from "node:fs";
import { rootPath } from "../../../../utils/paths";
import type { DoctorCheck } from "../check.types";

/**
 * A `## x.y.z` changelog heading with an optional ` - YYYY-MM-DD` suffix.
 * Mirrors the shape parsed by the tier-0 release-hygiene unit guard; inlined
 * here because that guard lives in the test tree and is not importable from
 * `src`.
 */
type ChangelogHeading = {
  version: string;
  date?: string;
};

/**
 * The parts of `package.json` this check reads.
 */
type ProjectManifest = {
  version?: unknown;
  private?: unknown;
  name?: unknown;
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
    date,
  };
}

/**
 * Whether this project is something anyone could `npm publish`.
 *
 * THE GATE, and the reason it exists: a changelog is a promise to the people
 * who install your package. An application has no such people. Running this
 * check on every project projected the framework monorepo's own release
 * practice onto users building an app, who were told — on every single run,
 * forever — that their private application was missing a CHANGELOG.md it had no
 * reason to have. `"private": true` is exactly the field npm itself reads to
 * refuse a publish, so it is the honest test of whether the concern applies.
 */
function isPublishable(manifest: ProjectManifest): boolean {
  return manifest.private !== true && typeof manifest.name === "string";
}

/**
 * Checks that a PUBLISHABLE package's `package.json` version matches the
 * top-most `## x.y.z` heading in `CHANGELOG.md` — the same version↔changelog
 * invariant the release-hygiene unit guard enforces, surfaced as a pre-release
 * doctor check.
 *
 * NEEDS NO BOOTED APP — it reads two files from the project root.
 *
 * Verdicts:
 * - `"private": true`, or no package name → not applicable, no line at all;
 * - no `CHANGELOG.md` → `warn` (recommended for a published package, not
 *   mandatory);
 * - no parseable heading → `warn`;
 * - heading version ≠ package.json version → `fail`;
 * - otherwise → `ok`.
 */
export const releaseHygieneCheck: DoctorCheck = {
  name: "release-hygiene",
  run: () => {
    const packageJsonPath = rootPath("package.json");
    const changelogPath = rootPath("CHANGELOG.md");

    const manifest: ProjectManifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    if (!isPublishable(manifest)) {
      return undefined;
    }

    const pkgVersion = manifest.version;

    if (typeof pkgVersion !== "string") {
      return {
        name: "release-hygiene",
        status: "fail",
        detail: "package.json is publishable but has no string version field",
      };
    }

    if (!existsSync(changelogPath)) {
      return {
        name: "release-hygiene",
        status: "warn",
        detail: `no CHANGELOG.md at project root (package.json is ${pkgVersion})`,
      };
    }

    const changelog = readFileSync(changelogPath, "utf8");
    const heading = parseTopHeading(changelog);

    if (!heading) {
      return {
        name: "release-hygiene",
        status: "warn",
        detail: "CHANGELOG.md has no parseable `## x.y.z` heading",
      };
    }

    if (heading.version !== pkgVersion) {
      return {
        name: "release-hygiene",
        status: "fail",
        detail: `package.json ${pkgVersion} ≠ top CHANGELOG heading ${heading.version}`,
      };
    }

    return {
      name: "release-hygiene",
      status: "ok",
      detail: `package.json and CHANGELOG agree on ${pkgVersion}`,
    };
  },
};
