import { colors } from "@mongez/copper";
import { fileExistsAsync, getJsonFileAsync, putJsonFileAsync } from "@warlock.js/fs";
import { execSync } from "node:child_process";
import { rootPath } from "../utils";
import { fetchLatestVersion } from "../utils/npm-registry";
import { isNewerVersion } from "../utils/version-compare";
import { detectPackageManager, getInstallCommand } from "./package-manager";

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
 */
export async function updateWarlockPackages(
  options: UpdateWarlockPackagesOptions = {},
): Promise<void> {
  const runInstall = options.install ?? true;
  const packageJsonPath = rootPath("package.json");

  if (!(await fileExistsAsync(packageJsonPath))) {
    console.log(`${colors.red("✖")} No package.json found at the project root.`);
    return;
  }

  const packageJson = (await getJsonFileAsync(packageJsonPath)) as PackageJson;
  const dependencies = collectWarlockDependencies(packageJson);

  if (dependencies.length === 0) {
    console.log(`${colors.yellow("⚠")} No @warlock.js packages found in package.json.`);
    return;
  }

  console.log(
    `${colors.cyan("›")} Checking ${colors.bold(String(dependencies.length))} ` +
      `@warlock.js package(s) for updates…`,
  );

  const resolved = await resolveLatestVersions(dependencies);
  const updates = resolvePackageUpdates(resolved);

  if (updates.length === 0) {
    console.log(`${colors.green("✓")} All @warlock.js packages are already up to date.`);
    return;
  }

  applyUpdates(packageJson, updates);
  await putJsonFileAsync(packageJsonPath, packageJson);

  printUpdates(updates);

  if (!runInstall) {
    console.log(
      colors.dim("Skipped install (--no-install). Run your package manager to apply the changes."),
    );
    return;
  }

  await installDependencies();
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

  return { operator: match[1] ?? "", version: match[2] };
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

/** Print the list of applied version bumps. */
function printUpdates(updates: PackageUpdate[]): void {
  console.log(`${colors.green("✓")} Updated ${colors.bold(String(updates.length))} package(s):`);

  for (const update of updates) {
    console.log(
      `   ${colors.cyan(update.name)}  ` +
        `${colors.dim(update.from)} ${colors.dim("→")} ${colors.greenBright(update.to)}`,
    );
  }
}

/** Reconcile node_modules to the rewritten package.json via the project PM. */
async function installDependencies(): Promise<void> {
  const packageManager = await detectPackageManager();
  const installCommand = getInstallCommand(packageManager);

  console.log(`${colors.cyan("›")} Running ${colors.bold(installCommand)}…`);

  execSync(installCommand, { cwd: process.cwd(), stdio: "inherit" });
}
