import { colors } from "@mongez/copper";
import { getWarlockVersion } from "../utils/framework-vesion";
import { fetchLatestVersion } from "../utils/npm-registry";
import { isNewerVersion } from "../utils/version-compare";
import { warlockConfigManager } from "../warlock-config";

/** The package whose version represents the whole (lockstep) family. */
const CORE_PACKAGE = "@warlock.js/core";

/** Where developers can read what changed between releases. */
const CHANGELOG_URL = "https://warlock.js.org/changelog/";

/**
 * Check npm for a newer `@warlock.js/core` release and, if one exists, print
 * a short non-blocking notice to the terminal. Because the whole family is
 * released in lockstep, core's version stands in for every `@warlock.js/*`
 * package, so a single lookup is enough.
 *
 * Designed to be called fire-and-forget right after the dev server is ready:
 * it never throws, never blocks startup, and stays silent unless there is a
 * genuinely newer version to report. Automatically skipped in CI, in
 * non-interactive (non-TTY) shells, and when `devServer.checkForUpdates` is
 * set to `false`.
 */
export async function checkForFrameworkUpdate(): Promise<void> {
  try {
    if (!isUpdateCheckEnabled()) {
      return;
    }

    const devServerConfig = await warlockConfigManager.get("devServer");

    if (devServerConfig?.checkForUpdates === false) {
      return;
    }

    const currentVersion = await getWarlockVersion();
    const latestVersion = await fetchLatestVersion(CORE_PACKAGE);

    if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) {
      return;
    }

    printUpdateNotice(currentVersion, latestVersion);
  } catch {
    // An update check is a convenience — never let it disrupt the dev server.
  }
}

/**
 * Whether an update check should run at all in the current environment.
 * Mirrors npm's own update-notifier conventions: stay quiet in CI, in
 * non-interactive shells, and when explicitly opted out via env.
 */
function isUpdateCheckEnabled(): boolean {
  if (process.env.CI) {
    return false;
  }

  if (process.env.NO_UPDATE_NOTIFIER) {
    return false;
  }

  if (!process.stdout.isTTY) {
    return false;
  }

  return true;
}

/**
 * Print the "update available" notice in the dev-logger's visual style.
 */
function printUpdateNotice(currentVersion: string, latestVersion: string): void {
  console.log();
  console.log(
    `  ${colors.yellow("⚡")} ${colors.bold("A new version of Warlock.js is available")}  ` +
      `${colors.dim(currentVersion)} ${colors.dim("→")} ${colors.greenBright(latestVersion)}`,
  );
  console.log(
    `     ${colors.dim("Run")} ${colors.cyan("npx warlock update")} ` +
      `${colors.dim("to update all @warlock.js packages")}`,
  );
  console.log(`     ${colors.dim("Changelog")} ${colors.cyan(CHANGELOG_URL)}`);
  console.log();
}
