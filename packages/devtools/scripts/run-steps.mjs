import { spawnSync } from "node:child_process";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");

/**
 * Runs each step (a binary entry file under this package's `node_modules`
 * and its arguments) one after the other with this Node, without a shell,
 * and exits with the first failure.
 * The release gate runs a package script as a single `node <entry>` command,
 * so scripts with two passes (server and dashboard) go through here.
 */
export function runSteps(steps) {
  for (const [entry, ...args] of steps) {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "node_modules", entry), ...args],
      {
        cwd: packageRoot,
        stdio: "inherit",
      },
    );

    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
