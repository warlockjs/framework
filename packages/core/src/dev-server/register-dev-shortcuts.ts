import { colors } from "@mongez/copper";
import { devLogError } from "./dev-logger";
import type { DevelopmentServer } from "./development-server";
import { restartDevServer } from "./restart-dev-server";
import { devServerShortcuts } from "./shortcuts";

/**
 * Arm the dev server's standing keyboard shortcuts and print the one-line
 * hint that tells the developer they exist.
 *
 * These stay available for the whole session. The update shortcut (`u`) is
 * deliberately not here — it is armed by the update notice only when there is
 * something to update, and dropped again once it has been used.
 *
 * Entirely TTY-gated: with piped stdin (CI, a supervisor, `warlock dev | tee`)
 * nothing is registered, no hint is printed, and stdin is never touched.
 */
export function registerDevShortcuts(devServer: DevelopmentServer): void {
  if (!devServerShortcuts.isSupported()) {
    return;
  }

  devServerShortcuts.register({
    key: "r",
    description: "restart the server",
    handler: () => restart(devServer),
  });

  devServerShortcuts.register({
    key: "c",
    description: "clear the console",
    handler: () => console.clear(),
  });

  devServerShortcuts.register({
    key: "q",
    description: "quit",
    handler: () => quit(devServer),
  });

  devServerShortcuts.register({
    key: "h",
    description: "show this help",
    handler: printShortcuts,
  });

  console.log(
    `   ${colors.dim("press")} ${colors.bold(colors.cyan("h"))} ` +
      `${colors.dim("for shortcuts")}`,
  );
}

/** `r` — bring the server back up on a clean process. */
async function restart(devServer: DevelopmentServer): Promise<void> {
  const restarted = await restartDevServer(devServer);

  if (!restarted) {
    devServerShortcuts.resume();
    devLogError("Restart failed — start the dev server again manually.");
  }
}

/** `q` — the same graceful shutdown Ctrl+C performs. */
async function quit(devServer: DevelopmentServer): Promise<void> {
  try {
    await devServer.shutdown();
    process.exit(0);
  } catch (error) {
    devLogError(`Shutdown failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

/** `h` — list whatever is armed right now, `u` included when it is. */
function printShortcuts(): void {
  console.log();
  console.log(`  ${colors.bold("Shortcuts")}`);

  for (const shortcut of devServerShortcuts.list()) {
    console.log(
      `     ${colors.bold(colors.cyan(shortcut.key))}  ${colors.dim(shortcut.description)}`,
    );
  }

  console.log(`     ${colors.bold(colors.cyan("Ctrl+C"))}  ${colors.dim("quit")}`);
  console.log();
}
