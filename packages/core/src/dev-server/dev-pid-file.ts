import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Where the dev server records its process id, relative to the project root. */
export const DEV_PID_FILE = path.join(".warlock", "dev.pid");

/**
 * Record the process that serves as the dev server.
 *
 * `warlock dev` starts a thin supervisor that spawns the real server, so the
 * PID a shell or a script got for the command is not the one that holds the
 * port. This file names the server itself: stop it with
 * `kill "$(cat .warlock/dev.pid)"`. The file is removed when the process exits.
 *
 * @param root The project root (default: the working directory).
 * @returns A function that removes the file now, if it still names this process.
 */
export function writeDevPidFile(root: string = process.cwd()): () => void {
  const file = path.join(root, DEV_PID_FILE);
  const pid = String(process.pid);

  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${pid}\n`);
  } catch {
    // The PID file is a convenience; a read-only checkout must still boot.
    return () => undefined;
  }

  let removed = false;

  const remove = () => {
    if (removed) return;

    removed = true;

    try {
      // A replacement server may already have written its own PID.
      if (readFileSync(file, "utf8").trim() === pid) rmSync(file, { force: true });
    } catch {
      // Already gone.
    }
  };

  process.once("exit", remove);

  return remove;
}
