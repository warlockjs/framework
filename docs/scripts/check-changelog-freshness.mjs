// @ts-check
/**
 * Docs changelog freshness gate.
 *
 * Compares the newest locally-published release recorded in
 * src/data/changelog.json against the newest version of @warlock.js/core
 * actually published on the npm registry, and hard-fails the build when the
 * docs site is behind what's really shipped.
 *
 * The registry is queried directly over HTTP (no npm CLI, no client cache)
 * so the check reflects what's live right now, not a stale local cache.
 *
 * Run via `node scripts/check-changelog-freshness.mjs` (wired on prebuild,
 * after the changelog generator). Supports `--changelog <path>` to point at
 * a different changelog.json, mainly for tests and recovery drills.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareSemverAsc } from "./generate-changelog.mjs";

/** True when `version` parses as valid SemVer per the shared comparator. */
function isValidSemver(version) {
  try {
    compareSemverAsc(version, version);
    return true;
  } catch {
    return false;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(here, "..");
const DEFAULT_CHANGELOG_PATH = resolve(DOCS_ROOT, "src/data/changelog.json");

const PACKAGE_NAME = "@warlock.js/core";
const REGISTRY_URL = "https://registry.npmjs.org/@warlock.js%2Fcore";

const ALLOW_UNREACHABLE_ENV = "WARLOCK_DOCS_ALLOW_REGISTRY_UNREACHABLE";
const ALLOW_UNREACHABLE_NOTE =
  "that escape hatch only covers registry unreachability — it cannot bypass a measured stale version.";

/** A registry/local data source responded, but its content is malformed or unusable. Never bypassable. */
export class FreshnessDataError extends Error {}

/** The registry could not be reached at all (network failure, 429, or 5xx). Bypassable only via the env escape. */
export class FreshnessUnreachableError extends Error {}

/** Parse `--changelog <path>` / `--changelog=<path>` out of argv. */
export function parseArgs(argv) {
  let changelogPath = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--changelog") {
      changelogPath = argv[i + 1] ?? null;
      i++;
    } else if (arg.startsWith("--changelog=")) {
      changelogPath = arg.slice("--changelog=".length);
    }
  }
  return { changelogPath };
}

/** Resolve a `--changelog` CLI value (relative to CWD) or fall back to src/data/changelog.json. */
export function resolveChangelogPath(changelogPath) {
  return changelogPath ? resolve(process.cwd(), changelogPath) : DEFAULT_CHANGELOG_PATH;
}

/** Read the local changelog.json and return its highest published (non-"Unreleased") SemVer version. */
export async function getLocalNewestVersion(changelogPath) {
  let raw;
  try {
    raw = await readFile(changelogPath, "utf8");
  } catch (err) {
    throw new FreshnessDataError(
      `local changelog not found or unreadable at ${changelogPath}: ${err.message}`,
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new FreshnessDataError(
      `local changelog at ${changelogPath} is not valid JSON: ${err.message}`,
    );
  }

  const releases = Array.isArray(data?.releases) ? data.releases : null;
  if (!releases) {
    throw new FreshnessDataError(`local changelog at ${changelogPath} has no "releases" array`);
  }

  let newest = null;
  for (const release of releases) {
    const version = release?.version;
    if (typeof version === "string" && /unreleased/i.test(version)) continue;
    if (typeof version !== "string") {
      throw new FreshnessDataError(
        `local changelog at ${changelogPath} has a release entry missing a string "version": ${JSON.stringify(release)}`,
      );
    }
    if (!isValidSemver(version)) {
      throw new FreshnessDataError(
        `local changelog at ${changelogPath} has an invalid SemVer release version: ${JSON.stringify(version)}`,
      );
    }
    if (newest === null || compareSemverAsc(version, newest) > 0) newest = version;
  }

  if (newest === null) {
    throw new FreshnessDataError(
      `local changelog at ${changelogPath} has no published SemVer release versions`,
    );
  }
  return newest;
}

/** Fetch the @warlock.js/core packument directly from the registry and return its highest valid SemVer version. */
export async function getRegistryNewestVersion(fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(REGISTRY_URL, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "Cache-Control": "no-cache", Accept: "application/json" },
    });
  } catch (err) {
    throw new FreshnessUnreachableError(
      `could not reach the npm registry at ${REGISTRY_URL}: ${err.message}`,
    );
  }

  if (response.status === 429 || response.status >= 500) {
    throw new FreshnessUnreachableError(
      `npm registry at ${REGISTRY_URL} responded with ${response.status} ${response.statusText}`,
    );
  }
  if (!response.ok) {
    throw new FreshnessDataError(
      `npm registry at ${REGISTRY_URL} responded with ${response.status} ${response.statusText}`,
    );
  }

  let packument;
  try {
    packument = await response.json();
  } catch (err) {
    throw new FreshnessDataError(
      `npm registry response for ${PACKAGE_NAME} is not valid JSON: ${err.message}`,
    );
  }

  const versions =
    packument && typeof packument.versions === "object" && packument.versions !== null
      ? Object.keys(packument.versions)
      : null;
  if (!versions || versions.length === 0) {
    throw new FreshnessDataError(`npm registry packument for ${PACKAGE_NAME} has no "versions"`);
  }

  let newest = null;
  for (const version of versions) {
    if (!isValidSemver(version)) {
      throw new FreshnessDataError(
        `npm registry packument for ${PACKAGE_NAME} has a malformed "versions" key: ${JSON.stringify(version)}`,
      );
    }
    if (newest === null || compareSemverAsc(version, newest) > 0) newest = version;
  }
  if (newest === null) {
    throw new FreshnessDataError(
      `npm registry packument for ${PACKAGE_NAME} has no valid SemVer version keys`,
    );
  }
  return newest;
}

/** Pure comparison: is the local newest release behind the registry's newest published version? */
export function evaluateFreshness(localVersion, registryVersion) {
  const diff = compareSemverAsc(localVersion, registryVersion);
  if (diff < 0) {
    return {
      status: "stale",
      message:
        `docs changelog is stale: local newest release is ${localVersion}, but the npm registry's ` +
        `newest published ${PACKAGE_NAME} version is ${registryVersion}. This is a measured staleness ` +
        `and cannot be bypassed — update src/data/releases.json / the package CHANGELOGs and re-run ` +
        `\`pnpm sync:changelog\` before building.`,
    };
  }
  return {
    status: "current",
    message: `docs changelog is current: local newest release ${localVersion} is at or ahead of the registry's ${registryVersion}.`,
  };
}

/** Run the full gate: local newest vs. registry newest, honoring the unreachability escape hatch. */
export async function main(argv = process.argv.slice(2), { fetchImpl = fetch } = {}) {
  const { changelogPath: changelogArg } = parseArgs(argv);
  const changelogPath = resolveChangelogPath(changelogArg);

  const localVersion = await getLocalNewestVersion(changelogPath);

  let registryVersion;
  try {
    registryVersion = await getRegistryNewestVersion(fetchImpl);
  } catch (err) {
    if (err instanceof FreshnessUnreachableError) {
      if (process.env[ALLOW_UNREACHABLE_ENV] === "1") {
        const message =
          `WARNING: changelog freshness check could not reach the npm registry (${err.message}). ` +
          `Proceeding because ${ALLOW_UNREACHABLE_ENV}=1 is set — ${ALLOW_UNREACHABLE_NOTE}`;
        console.warn(message);
        return { status: "unreachable-allowed", message };
      }
      throw new Error(
        `changelog freshness check could not reach the npm registry: ${err.message}. Set ` +
          `${ALLOW_UNREACHABLE_ENV}=1 to proceed anyway — ${ALLOW_UNREACHABLE_NOTE}`,
      );
    }
    // FreshnessDataError (and anything unexpected) is a contract failure — never bypassable.
    throw err;
  }

  const result = evaluateFreshness(localVersion, registryVersion);
  if (result.status === "stale") {
    throw new Error(result.message);
  }
  console.log(result.message);
  return result;
}

// Guard so `import` (e.g. from the test file) never triggers a network call —
// only executing this file directly (`node scripts/check-changelog-freshness.mjs`) does.
const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((err) => {
    console.error("check-changelog-freshness failed:", err.message);
    // Let fetch/AbortSignal resources close naturally. An immediate process.exit()
    // can trip a libuv handle-closing assertion on Windows after a registry request.
    process.exitCode = 1;
  });
}
