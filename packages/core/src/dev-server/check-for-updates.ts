import { colors } from "@mongez/copper";
import { updateWarlockPackages } from "../updater/update-warlock-packages";
import { getWarlockVersion } from "../utils/framework-vesion";
import { fetchLatestVersion } from "../utils/npm-registry";
import { isNewerVersion } from "../utils/version-compare";
import { warlockConfigManager } from "../warlock-config";
import type { DevelopmentServer } from "./development-server";
import { restartDevServer } from "./restart-dev-server";
import { devServerShortcuts } from "./shortcuts";
import {
  clearCachedLatestVersion,
  readCachedLatestVersion,
  writeCachedLatestVersion,
} from "./update-check-cache";

/** The package whose version represents the whole (lockstep) family. */
const CORE_PACKAGE = "@warlock.js/core";

/** Where developers can read what changed between releases. */
const CHANGELOG_URL = "https://warlock.js.org/changelog/";

/** The key that applies the update without leaving the dev server. */
const UPDATE_SHORTCUT_KEY = "u";

/**
 * Abort budget for the notice's registry lookup. Deliberately much shorter
 * than the `warlock update` command's: nobody is waiting on this answer, and
 * a network that hangs (captive portal, dead VPN, flaky DNS) must not leave a
 * pending request and a live timer sitting around behind a running dev server.
 */
const UPDATE_CHECK_TIMEOUT_MS = 5_000;

/**
 * Check npm for a newer `@warlock.js/core` release and, if one exists, print
 * a short non-blocking notice to the terminal. Because the whole family is
 * released in lockstep, core's version stands in for every `@warlock.js/*`
 * package, so a single lookup is enough.
 *
 * When a `devServer` is passed and the terminal is interactive, the notice
 * also arms the `u` shortcut: one keypress updates every `@warlock.js/*`
 * dependency, installs, and restarts the server.
 *
 * Designed to be called fire-and-forget once the dev server is ready: it
 * never throws, never blocks startup, and stays silent unless there is a
 * genuinely newer version to report. Automatically skipped in CI, in
 * non-interactive (non-TTY) shells, and when `devServer.checkForUpdates` is
 * set to `false`.
 */
export async function checkForFrameworkUpdate(devServer?: DevelopmentServer): Promise<void> {
  try {
    if (!isUpdateCheckEnabled()) {
      return;
    }

    const devServerConfig = await warlockConfigManager.get("devServer");

    if (devServerConfig?.checkForUpdates === false) {
      return;
    }

    const currentVersion = await getWarlockVersion();
    const latestVersion = await resolveLatestVersion();

    if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) {
      return;
    }

    printUpdateNotice(currentVersion, latestVersion, offerUpdateShortcut(devServer));
  } catch {
    // An update check is a convenience — never let it disrupt the dev server.
  }
}

/**
 * The latest published core version, preferring a recent cached answer over a
 * network round-trip. Every `warlock dev` boot would otherwise hit npm, which
 * is a lot of traffic for a question whose answer changes a few times a month.
 */
async function resolveLatestVersion(): Promise<string | undefined> {
  const cached = await readCachedLatestVersion();

  if (cached) {
    return cached;
  }

  const latestVersion = await fetchLatestVersion(CORE_PACKAGE, UPDATE_CHECK_TIMEOUT_MS);

  // A failed lookup is deliberately NOT cached as "no version" — that would
  // silence the notice for a day over one flaky moment. Only real answers are
  // remembered; offline simply re-asks next boot.
  if (latestVersion) {
    await writeCachedLatestVersion(latestVersion);
  }

  return latestVersion;
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
 * Arm the `u` shortcut, if there is a server to restart and a terminal that
 * can deliver keypresses. Returns whether the notice may advertise it.
 */
function offerUpdateShortcut(devServer?: DevelopmentServer): boolean {
  if (!devServer) {
    return false;
  }

  return devServerShortcuts.register({
    key: UPDATE_SHORTCUT_KEY,
    description: "update @warlock.js packages and restart",
    handler: () => updateAndRestart(devServer),
  });
}

/**
 * The `u` handler: rewrite the `@warlock.js/*` versions, install them, and
 * come back up on the new ones.
 *
 * The shortcut is dropped and the terminal released first, so the package
 * manager child owns stdin (and a second `u` can't stack a parallel install).
 * Releasing has to be explicit: the standing shortcut bar keeps other keys
 * registered, so dropping `u` alone would leave us in raw mode.
 *
 * The terminal is taken back — and `u` re-armed — only for the cases worth
 * retrying: an unreachable registry, or a restart that could not be started.
 */
async function updateAndRestart(devServer: DevelopmentServer): Promise<void> {
  devServerShortcuts.unregister(UPDATE_SHORTCUT_KEY);
  devServerShortcuts.release();

  console.log();

  const result = await updateWarlockPackages();

  if (result.outcome === "updated") {
    // The remembered answer described the version we just replaced.
    await clearCachedLatestVersion();

    const restarted = await restartDevServer(devServer);

    if (!restarted) {
      devServerShortcuts.resume();
      console.log(`     ${colors.dim("Restart the dev server manually to load the new version.")}`);
    }

    return;
  }

  devServerShortcuts.resume();

  if (result.outcome === "registry-unreachable") {
    printShortcutRetryHint();
    offerUpdateShortcut(devServer);
    return;
  }

  // Anything else — a failed install, or a notice that turned out to be stale —
  // leaves the shortcut off on purpose: package.json is already rewritten, so a
  // second `u` would just report "up to date" and hide the real problem.
}

/**
 * Print the "update available" notice in the dev-logger's visual style.
 *
 * @param canPressKey Whether the `u` shortcut is armed. When it is not (piped
 *                    stdin, CI, a supervisor), fall back to the command the
 *                    developer can run by hand.
 */
function printUpdateNotice(
  currentVersion: string,
  latestVersion: string,
  canPressKey: boolean,
): void {
  console.log();
  console.log(
    `  ${colors.yellow("⚡")} ${colors.bold("A new version of Warlock.js is available")}  ` +
      `${colors.dim(currentVersion)} ${colors.dim("→")} ${colors.greenBright(latestVersion)}`,
  );

  if (canPressKey) {
    console.log(
      `     ${colors.dim("Press")} ${colors.bold(colors.cyan(UPDATE_SHORTCUT_KEY))} ` +
        `${colors.dim("to update all @warlock.js packages and restart")}`,
    );
  } else {
    console.log(
      `     ${colors.dim("Run")} ${colors.cyan("npx warlock update")} ` +
        `${colors.dim("to update all @warlock.js packages")}`,
    );
  }

  console.log(`     ${colors.dim("Changelog")} ${colors.cyan(CHANGELOG_URL)}`);
  console.log();
}

/** Tell the developer the shortcut is still available after a failed try. */
function printShortcutRetryHint(): void {
  console.log(
    `     ${colors.dim("Press")} ${colors.bold(colors.cyan(UPDATE_SHORTCUT_KEY))} ` +
      `${colors.dim("to try again once you are back online")}`,
  );
  console.log();
}
