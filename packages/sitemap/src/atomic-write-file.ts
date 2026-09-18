import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** The subset of `node:fs/promises` this helper needs — swappable so a test can inject a failing write or rename without mocking the global module. */
export type AtomicWriteFileDeps = {
  writeFile: typeof writeFile;
  rename: typeof rename;
  rm: typeof rm;
};

const defaultDeps: AtomicWriteFileDeps = { writeFile, rename, rm };

const RENAME_RETRY_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Windows can report a rename over an existing file as EPERM/EBUSY while something briefly holds the target (an AV scan, a reader) — retrying is correct there, not a masked bug. */
function isTransientRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;

  return code === "EPERM" || code === "EBUSY";
}

async function renameWithRetry(from: string, to: string, deps: AtomicWriteFileDeps): Promise<void> {
  for (let attempt = 1; attempt <= RENAME_RETRY_ATTEMPTS; attempt++) {
    try {
      await deps.rename(from, to);

      return;
    } catch (error) {
      if (attempt === RENAME_RETRY_ATTEMPTS || !isTransientRenameError(error)) throw error;

      await delay(RENAME_RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * Writes `content` to `filePath` atomically: the content lands in a unique
 * sibling temp file first — same directory, so same filesystem, so the
 * rename that follows is atomic — and only then is renamed over the target.
 * An interrupted or failing write never truncates or otherwise touches the
 * existing target; on any failure the temp file is removed and the error is
 * rethrown.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  deps: AtomicWriteFileDeps = defaultDeps,
): Promise<void> {
  const tempPath = join(
    dirname(filePath),
    `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  try {
    await deps.writeFile(tempPath, content, "utf8");
    await renameWithRetry(tempPath, filePath, deps);
  } catch (error) {
    await deps.rm(tempPath, { force: true }).catch(() => undefined);

    throw error;
  }
}
