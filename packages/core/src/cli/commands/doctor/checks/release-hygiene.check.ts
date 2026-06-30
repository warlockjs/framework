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
 * Checks that the project's `package.json` version matches the top-most
 * `## x.y.z` heading in `CHANGELOG.md` — the same version↔changelog invariant
 * the release-hygiene unit guard enforces, surfaced as a pre-release doctor
 * check.
 *
 * Verdicts:
 * - no `CHANGELOG.md` → `warn` (a changelog is recommended, not mandatory);
 * - no parseable heading → `warn`;
 * - heading version ≠ package.json version → `fail`;
 * - otherwise → `ok`.
 *
 * Read-only: reads `package.json` and `CHANGELOG.md` from the project root.
 */
export const releaseHygieneCheck: DoctorCheck = {
  name: "release-hygiene",
  run: () => {
    const packageJsonPath = rootPath("package.json");
    const changelogPath = rootPath("CHANGELOG.md");

    const pkgVersion: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;

    if (typeof pkgVersion !== "string") {
      return {
        name: "release-hygiene",
        status: "fail",
        detail: "package.json has no string version field",
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
