import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CliHome, CliLaunchFile } from "../contracts";

/** The directories one run uses. */
export type RunDirectories = {
  /** Private per-run directory (0700) for run-scoped files. */
  runDir: string;
  /** The CLI's config home, or `undefined` for `home: "inherit"`. */
  home?: string;
  /** Whether `home` lives inside `runDir` (created for this run, deleted after it). */
  homeIsPrivate: boolean;
  /** Remove everything this run created. Never touches a caller-owned home. */
  dispose(): Promise<void>;
};

/**
 * Create the run's private directory and resolve its config home.
 *
 * The run directory is `mkdtemp`'d under the OS temp dir with mode 0700, so
 * other local users cannot read the MCP config (and the tokens in it)
 * written there. A `"private"` home is a `home/` folder inside it.
 */
export async function createRunDirectories(home: CliHome, cwd: string): Promise<RunDirectories> {
  const runDir = await mkdtemp(path.join(tmpdir(), "warlock-cli-"));

  await chmod(runDir, 0o700);

  const dispose = async (): Promise<void> => {
    await rm(runDir, { recursive: true, force: true });
  };

  if (home === "inherit") {
    return { runDir, homeIsPrivate: false, dispose };
  }

  if (home === "private") {
    const privateHome = path.join(runDir, "home");

    await mkdir(privateHome, { mode: 0o700 });

    return { runDir, home: privateHome, homeIsPrivate: true, dispose };
  }

  const ownedHome = path.resolve(cwd, home);

  await mkdir(ownedHome, { recursive: true, mode: 0o700 });

  return { runDir, home: ownedHome, homeIsPrivate: false, dispose };
}

/**
 * Write launch files with owner-only permissions (0600; parent directories
 * 0700). Only paths inside the run directory or a private home are
 * accepted, so an adapter can never overwrite a file in a caller-owned
 * home or elsewhere on disk.
 */
export async function writeLaunchFiles(
  files: readonly CliLaunchFile[],
  directories: RunDirectories,
): Promise<void> {
  const roots = [directories.runDir];

  for (const file of files) {
    const target = path.resolve(file.path);
    const inside = roots.some((root) => {
      const relative = path.relative(root, target);

      return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
    });

    if (!inside) {
      throw new Error(
        `Refusing to write ${target}: launch files must live inside the run directory.`,
      );
    }

    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, file.content, { mode: 0o600 });
    await chmod(target, 0o600);
  }
}
