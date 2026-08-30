import { colors } from "@mongez/copper";
import {
  fileExistsAsync,
  getJsonFileAsync,
  putFileAsync,
  putJsonFileAsync,
} from "@warlock.js/fs";
import { execSync } from "node:child_process";
import { CommandActionData } from "../commands/types";
import {
  detectPackageManager,
  getAddCommand,
  type PackageManager,
} from "../updater/package-manager";
import { rootPath, srcPath } from "../utils";
import { getWarlockVersion } from "../utils/framework-vesion";
import { featuresMap } from "./features";

export { featuresMap };
export type { FeatureDefinition } from "./features";

/**
 * The parts of a project `package.json` this action reads or writes. Deliberately
 * partial — it describes what we touch, not the whole manifest.
 */
type ProjectPackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

export const allowedFeatures = Object.keys(featuresMap);

/**
 * Resolve the internal feature-map placeholder to the version of Core that is
 * actually executing the command. Every @warlock.js package is lockstep, so
 * Core is the single source of truth; non-Warlock dependencies are untouched.
 */
export function resolveWarlockDependencyVersions(
  dependencies: Record<string, string>,
  frameworkVersion: string,
): void {
  for (const dependency of Object.keys(dependencies)) {
    if (dependency.startsWith("@warlock.js/")) {
      dependencies[dependency] = frameworkVersion;
    }
  }
}

function resolveFeatures(features: string[], visited = new Set<string>()): string[] {
  const resolved: string[] = [];

  for (const feature of features) {
    if (visited.has(feature)) continue;
    visited.add(feature);

    const def = featuresMap[feature];

    if (def.requires?.length) {
      resolved.push(...resolveFeatures(def.requires, visited));
    }

    resolved.push(feature);
  }

  return resolved;
}

export async function addCommandAction(options: CommandActionData) {
  const features = options.args;
  const { packageManager, list, noInstall } = options.options;

  if (list) {
    console.log("Available Features:");

    for (const feature of allowedFeatures) {
      console.log(
        `- ${colors.yellowBright(feature)}: ${colors.green(featuresMap[feature].description)}`,
      );
    }

    process.exit(0);
  }

  validateFeatures(features);

  const resolvedFeatures = resolveFeatures(features);

  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  const ejectConfigs: Record<string, { content: string; name: string }> = {};
  const scripts: Record<string, string> = {};

  for (const feature of resolvedFeatures) {
    const featurePackages = featuresMap[feature as keyof typeof featuresMap];
    Object.assign(dependencies, featurePackages.dependencies);
    if (featurePackages.devDependencies) {
      Object.assign(devDependencies, featurePackages.devDependencies);
    }

    if (featurePackages.ejectConfig) {
      ejectConfigs[featurePackages.ejectConfig.name] = featurePackages.ejectConfig;
    }

    if (featurePackages.script) {
      Object.assign(scripts, featurePackages.script);
    }
  }

  // Pin every @warlock.js/* feature package to the INSTALLED framework version so
  // a scaffolded project's features match its core version instead of drifting to
  // the feature map's static range.
  const frameworkVersion = await getWarlockVersion();
  resolveWarlockDependencyVersions(dependencies, frameworkVersion);

  const currentPackageJson = await getJsonFileAsync<ProjectPackageJson>(rootPath("package.json"));

  // Fresh templates may omit one of the maps — guard before reading.
  currentPackageJson.dependencies = currentPackageJson.dependencies ?? {};
  currentPackageJson.devDependencies = currentPackageJson.devDependencies ?? {};

  // Skip anything already present so we never downgrade an existing pin.
  for (const dependency of Object.keys(dependencies)) {
    if (currentPackageJson.dependencies[dependency]) {
      console.log(`${colors.yellowBright(dependency)} is already installed, skipping...`);
      delete dependencies[dependency];
    }
  }

  for (const devDependency of Object.keys(devDependencies)) {
    if (currentPackageJson.devDependencies[devDependency]) {
      console.log(`${colors.yellowBright(devDependency)} is already installed, skipping...`);
      delete devDependencies[devDependency];
    }
  }

  if (noInstall) {
    await recordDependencies(dependencies, devDependencies);
  } else {
    await installDependencies(packageManager as PackageManager | undefined, dependencies, devDependencies);
  }

  for (const [name, config] of Object.entries(ejectConfigs)) {
    if (await fileExistsAsync(srcPath(`config/${name}.ts`))) {
      console.log(`${colors.yellowBright(name)} config already exists, skipping...`);
      continue;
    }

    console.log(`Creating ${colors.magenta(name)} config...`);

    await putFileAsync(srcPath(`config/${name}.ts`), config.content);

    console.log(`${colors.green(name)} config created successfully`);
  }

  // now loop again over features to execute onExecuting
  for (const feature of resolvedFeatures) {
    const featurePackages = featuresMap[feature as keyof typeof featuresMap];
    if (featurePackages.onExecuting) {
      await featurePackages.onExecuting(options);
    }
  }

  if (Object.keys(scripts).length > 0) {
    console.log(`Adding scripts ${colors.magenta(Object.keys(scripts).join(", "))}`);
    const packageJsonPath = rootPath("package.json");
    const packageJson = await getJsonFileAsync<ProjectPackageJson>(packageJsonPath);
    packageJson.scripts = { ...(packageJson.scripts ?? {}), ...scripts };
    await putJsonFileAsync(packageJsonPath, packageJson);

    console.log(`Scripts added successfully ${colors.green(Object.keys(scripts).join(", "))}`);
  }
}

/**
 * Install the resolved dependency sets through the project's package manager.
 * Runs two passes (prod then dev) so each lands in the correct section.
 */
async function installDependencies(
  packageManager: PackageManager | undefined,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
) {
  // `--package-manager` is optional; without it, fall back to the lockfile.
  const packageManagerCommand = getAddCommand(packageManager ?? (await detectPackageManager()));

  if (Object.keys(dependencies).length > 0) {
    console.log(`Installing dependencies ${colors.magenta(Object.keys(dependencies).join(", "))}`);

    execSync(`${packageManagerCommand} ${Object.keys(dependencies).join(" ")}`, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    console.log(
      `Dependencies installed successfully ${colors.green(Object.keys(dependencies).join(", "))}`,
    );
  }

  if (Object.keys(devDependencies).length > 0) {
    console.log(
      `Installing dev dependencies ${colors.magenta(Object.keys(devDependencies).join(", "))}`,
    );

    execSync(`${packageManagerCommand} ${Object.keys(devDependencies).join(" ")} -D`, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    console.log(
      `Dev dependencies installed successfully ${colors.green(Object.keys(devDependencies).join(", "))}`,
    );
  }
}

/**
 * Write the resolved dependency sets into package.json without installing.
 * Used by `--no-install` so a scaffolder can batch every feature into one
 * install pass after the command returns. Versions come from the feature map.
 */
async function recordDependencies(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
) {
  if (Object.keys(dependencies).length === 0 && Object.keys(devDependencies).length === 0) {
    return;
  }

  const packageJsonPath = rootPath("package.json");
  const packageJson = await getJsonFileAsync<ProjectPackageJson>(packageJsonPath);

  packageJson.dependencies = packageJson.dependencies ?? {};
  packageJson.devDependencies = packageJson.devDependencies ?? {};

  Object.assign(packageJson.dependencies, dependencies);
  Object.assign(packageJson.devDependencies, devDependencies);

  await putJsonFileAsync(packageJsonPath, packageJson);

  const recorded = [...Object.keys(dependencies), ...Object.keys(devDependencies)];

  console.log(
    `Recorded ${colors.green(recorded.join(", "))} in package.json (install skipped via --no-install)`,
  );
}

function validateFeatures(features: string[]) {
  for (const feature of features) {
    if (!allowedFeatures.includes(feature)) {
      console.log(
        `Feature ${colors.redBright(feature)} is not allowed, allowed features are: ${colors.green(allowedFeatures.join(", "))}`,
      );
      process.exit(1);
    }
  }
}
