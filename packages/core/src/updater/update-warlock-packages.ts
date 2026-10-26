import { colors } from "@mongez/copper";
import { fileExistsAsync, getJsonFileAsync, putJsonFileAsync } from "@warlock.js/fs";
import { execSync } from "node:child_process";
import { releaseNotesPointer } from "../release-notes/release-notes";
import { rootPath } from "../utils";
import { fetchLatestVersion } from "../utils/npm-registry";
import { isNewerVersion } from "../utils/version-compare";
import {
  detectPackageManager,
  detectPackageManagerDetails,
  getInstallCommand,
} from "./package-manager";
import {
  MIN_NPM_VERSION,
  oldNpmMessage,
  parseNpmVersion,
  pruneFamilyLockEntries,
} from "./prune-npm-lockfile";

/** Scope prefix that identifies a Warlock framework package. */
const WARLOCK_SCOPE = "@warlock.js/";

/** The dependency maps in package.json we update, in display order. */
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies"] as const;

type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

type DependencyMap = Record<string, string>;

type PackageJson = Record<string, unknown> & {
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
};

/** A `@warlock.js/*` dependency found in package.json. */
type WarlockDependency = {
  name: string;
  section: DependencySection;
  /** The current spec exactly as written, e.g. `^4.2.0`. */
  current: string;
};

/** A dependency whose latest version has been resolved from the registry. */
export type ResolvedDependency = WarlockDependency & {
  /** Latest version from npm, or `undefined` when the lookup failed. */
  latest: string | undefined;
};

/** A concrete version bump to write back into package.json. */
export type PackageUpdate = {
  name: string;
  section: DependencySection;
  /** Existing spec, e.g. `^4.2.0`. */
  from: string;
  /** New spec with the original range operator preserved, e.g. `^4.3.0`. */
  to: string;
};

/** Options accepted by {@link updateWarlockPackages}. */
export type UpdateWarlockPackagesOptions = {
  /** Run the package manager install after rewriting versions (default true). */
  install?: boolean;
  /**
   * Report what would change without touching package.json or node_modules.
   * Resolves with the `outdated` outcome instead of `updated`.
   */
  dryRun?: boolean;
};

/**
 * How an update run ended. Callers branch on this instead of re-deriving the
 * situation from the printed output — the dev-server `u` shortcut needs to
 * know whether restarting is warranted, and whether it may offer a retry.
 */
export type UpdateOutcome =
  /** No package.json at the project root — nothing to do. */
  | "no-package-json"
  /** package.json carries no `@warlock.js/*` dependency. */
  | "no-packages"
  /** Every registry lookup failed — offline, DNS down, or npm unreachable. */
  | "registry-unreachable"
  /** Every package is already at (or ahead of) its latest published version. */
  | "up-to-date"
  /** Newer versions exist, and a dry run left everything untouched. */
  | "outdated"
  /** Versions were rewritten (and installed, unless `install: false`). */
  | "updated"
  /** Versions were rewritten but the package manager install failed. */
  | "install-failed";

/** The result of an update run. */
export type UpdateWarlockPackagesResult = {
  outcome: UpdateOutcome;
  /** The bumps written to package.json — empty unless `outcome` wrote any. */
  updates: PackageUpdate[];
  /** The install failure, present only for `install-failed`. */
  error?: Error;
};

/**
 * Update every `@warlock.js/*` package listed in the project's root
 * package.json to its latest published version, then reconcile `node_modules`
 * via the detected package manager.
 *
 * The original range operator on each dependency (`^`, `~`, or an exact pin)
 * is preserved; specs that aren't a plain semver — `workspace:*`, `*`,
 * `latest`, git/file URLs — are left untouched. Only genuine upgrades are
 * written, so re-running on an already-current project is a no-op.
 *
 * Resolves rather than throws on the two failures a caller is expected to
 * survive — an unreachable registry and a failed install — so the dev-server
 * shortcut can report them and keep serving.
 */
export async function updateWarlockPackages(
  options: UpdateWarlockPackagesOptions = {},
): Promise<UpdateWarlockPackagesResult> {
  const runInstall = options.install ?? true;
  const packageJsonPath = rootPath("package.json");

  if (!(await fileExistsAsync(packageJsonPath))) {
    console.log(`${colors.red("✖")} No package.json found at the project root.`);
    return { outcome: "no-package-json", updates: [] };
  }

  const packageJson = (await getJsonFileAsync(packageJsonPath)) as PackageJson;
  const dependencies = collectWarlockDependencies(packageJson);

  if (dependencies.length === 0) {
    console.log(`${colors.yellow("⚠")} No @warlock.js packages found in package.json.`);
    return { outcome: "no-packages", updates: [] };
  }

  console.log(
    `${colors.cyan("›")} Checking ${colors.bold(String(dependencies.length))} ` +
      `@warlock.js package(s) for updates…`,
  );

  const resolved = await resolveLatestVersions(dependencies);

  // Distinguish "nothing newer" from "we never got an answer". Without this,
  // an offline run reports every package as up to date, which is a lie.
  if (isRegistryUnreachable(resolved)) {
    console.log(
      `${colors.yellow("⚠")} Could not reach the npm registry — ` +
        `no versions were changed. Check your connection and try again.`,
    );
    return { outcome: "registry-unreachable", updates: [] };
  }

  // A partial failure would bump some family members and leave others behind,
  // a lockstep drift reported as success. Refuse the whole run instead.
  const failedLookups = resolved.filter((dependency) => !dependency.latest);

  if (failedLookups.length > 0) {
    console.log(
      `${colors.yellow("⚠")} Could not look up ${failedLookups.map((dependency) => dependency.name).join(", ")} — ` +
        `no versions were changed, to keep @warlock.js packages in lockstep. Try again.`,
    );
    return { outcome: "registry-unreachable", updates: [] };
  }

  const updates = resolvePackageUpdates(resolved);

  if (updates.length === 0) {
    console.log(`${colors.green("✓")} All @warlock.js packages are already up to date.`);
    return { outcome: "up-to-date", updates: [] };
  }

  if (options.dryRun) {
    printUpdates(updates, { pending: true });
    printReleaseNotesPointer(updates);
    return { outcome: "outdated", updates };
  }

  applyUpdates(packageJson, updates);
  await putJsonFileAsync(packageJsonPath, packageJson);

  printUpdates(updates);

  if (!runInstall) {
    const detection = await detectPackageManagerDetails();
    const command = getInstallCommand(detection.packageManager);

    console.log(
      colors.dim(`Package manager: ${detection.packageManager}, because ${detection.reason}.`),
    );
    console.log(colors.dim(`Skipped install (--no-install). Run ${command} to apply the changes.`));
    printReleaseNotesPointer(updates);
    return { outcome: "updated", updates };
  }

  try {
    await installDependencies();
  } catch (error) {
    console.log(
      `${colors.red("✖")} The install failed. package.json is already updated — ` +
        `re-run ${getInstallCommand(await detectPackageManager())} to finish.`,
    );
    return { outcome: "install-failed", updates, error: error as Error };
  }

  printReleaseNotesPointer(updates);

  return { outcome: "updated", updates };
}

/**
 * Whether *every* lookup came back empty, which in practice means the
 * registry was never reached. A single failed package (unpublished, renamed,
 * private) leaves the rest resolvable and is not treated as an outage.
 */
export function isRegistryUnreachable(resolved: ResolvedDependency[]): boolean {
  return resolved.length > 0 && resolved.every((dependency) => !dependency.latest);
}

/** Collect every `@warlock.js/*` dependency across the relevant sections. */
function collectWarlockDependencies(packageJson: PackageJson): WarlockDependency[] {
  const dependencies: WarlockDependency[] = [];

  for (const section of DEPENDENCY_SECTIONS) {
    const map = packageJson[section];

    if (!map) {
      continue;
    }

    for (const [name, current] of Object.entries(map)) {
      if (name.startsWith(WARLOCK_SCOPE)) {
        dependencies.push({ name, section, current });
      }
    }
  }

  return dependencies;
}

/** Resolve each dependency's latest version from the registry in parallel. */
async function resolveLatestVersions(
  dependencies: WarlockDependency[],
): Promise<ResolvedDependency[]> {
  return Promise.all(
    dependencies.map(async (dependency) => ({
      ...dependency,
      latest: await fetchLatestVersion(dependency.name),
    })),
  );
}

/**
 * Turn resolved dependencies into the concrete set of version bumps to write.
 * Pure (no I/O) so it can be unit-tested directly: skips lookups that failed,
 * non-semver specs, and anything already at (or ahead of) the latest version,
 * and preserves the original range operator on everything it does rewrite.
 */
export function resolvePackageUpdates(resolved: ResolvedDependency[]): PackageUpdate[] {
  const updates: PackageUpdate[] = [];

  for (const dependency of resolved) {
    if (!dependency.latest) {
      continue;
    }

    const parsed = parseSpec(dependency.current);

    if (!parsed) {
      continue;
    }

    if (!isNewerVersion(dependency.latest, parsed.version)) {
      continue;
    }

    updates.push({
      name: dependency.name,
      section: dependency.section,
      from: dependency.current,
      to: `${parsed.operator}${dependency.latest}`,
    });
  }

  return updates;
}

/**
 * Split a dependency spec into its range operator and concrete version.
 * Returns `undefined` for specs we won't touch — `workspace:*`, `*`,
 * `latest`, multi-part ranges, or git/file URLs — leaving them exactly as
 * the author wrote them.
 */
function parseSpec(spec: string): { operator: string; version: string } | undefined {
  const match = spec.trim().match(/^(\^|~)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);

  if (!match) {
    return undefined;
  }

  const version = match[2];

  if (version === undefined) {
    return undefined;
  }

  return { operator: match[1] ?? "", version };
}

/** Write the resolved bumps back into the package.json object in place. */
function applyUpdates(packageJson: PackageJson, updates: PackageUpdate[]): void {
  for (const update of updates) {
    const map = packageJson[update.section];

    if (map) {
      map[update.name] = update.to;
    }
  }
}

/** Print the version bumps — applied, or pending on a dry run. */
function printUpdates(updates: PackageUpdate[], { pending = false } = {}): void {
  const headline = pending
    ? `${colors.yellow("↑")} ${colors.bold(String(updates.length))} package(s) can be updated:`
    : `${colors.green("✓")} Updated ${colors.bold(String(updates.length))} package(s):`;

  console.log(headline);

  for (const update of updates) {
    console.log(
      `   ${colors.cyan(update.name)}  ` +
        `${colors.dim(update.from)} ${colors.dim("→")} ${colors.greenBright(update.to)}`,
    );
  }
}

/** End an update with one line pointing at the release summaries since the old version. */
function printReleaseNotesPointer(updates: PackageUpdate[]): void {
  const core = updates.find((update) => update.name === "@warlock.js/core") ?? updates[0];

  if (core) console.log(colors.dim(releaseNotesPointer(core.from)));
}

/** Reconcile node_modules to the rewritten package.json via the project PM. */
async function installDependencies(): Promise<void> {
  const { packageManager, ambiguous, reason } = await detectPackageManagerDetails();
  const installCommand = getInstallCommand(packageManager);

  console.log(
    `${colors.cyan("›")} Package manager: ${colors.bold(packageManager)}, because ${reason}.`,
  );

  if (ambiguous.length > 0) {
    console.log(
      `${colors.yellow("⚠")} Found ${ambiguous.join(" and ")}. Set "packageManager" in package.json to choose.`,
    );
  }

  let npmVersion: string | undefined;

  if (packageManager === "npm") {
    npmVersion = readNpmVersion();

    if (npmVersion && isNewerVersion(MIN_NPM_VERSION, npmVersion)) {
      console.log(`${colors.yellow("⚠")} ${oldNpmMessage(npmVersion)}`);
    }

    await pruneNpmLockfile();
  }

  console.log(`${colors.cyan("›")} Running ${colors.bold(installCommand)}…`);

  try {
    execSync(installCommand, { cwd: process.cwd(), stdio: "inherit" });
  } catch (error) {
    if (npmVersion && isNewerVersion(MIN_NPM_VERSION, npmVersion)) {
      console.log(`${colors.yellow("⚠")} ${oldNpmMessage(npmVersion)}`);
    }

    throw error;
  }
}

/** The version of the `npm` on PATH, or `undefined` when it cannot be run. */
function readNpmVersion(): string | undefined {
  try {
    return parseNpmVersion(execSync("npm --version", { encoding: "utf8", stdio: "pipe" }));
  } catch {
    return undefined;
  }
}

/**
 * Drop the family's (and Vite/Vitest's) entries from package-lock.json so the
 * install that follows re-resolves them together. npm cannot step the family
 * entry by entry: each member's peer range names the others.
 */
async function pruneNpmLockfile(): Promise<void> {
  const lockfilePath = rootPath("package-lock.json");

  if (!(await fileExistsAsync(lockfilePath))) return;

  const lockfile = (await getJsonFileAsync(lockfilePath)) as Parameters<
    typeof pruneFamilyLockEntries
  >[0];
  const removed = pruneFamilyLockEntries(lockfile);

  if (removed.length === 0) return;

  await putJsonFileAsync(lockfilePath, lockfile);
  console.log(
    colors.dim(
      `Removed ${removed.length} package(s) from package-lock.json to re-resolve them together.`,
    ),
  );
}
