import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { UnownedOutputDirectoryError } from "./errors";

/**
 * Marks a directory as one `publishAtomically` swapped into place. Its
 * presence is the ONLY thing that lets a later publish treat the directory
 * as safe to swap out from under itself — see {@link assertOutDirIsOwned}.
 */
const OWNERSHIP_MARKER_FILE = ".sitemap-set.json";
const OWNERSHIP_MARKER_VERSION = 1;

async function validateShards(tempDir: string, fileNames: readonly string[]): Promise<void> {
  for (const fileName of fileNames) {
    const info = await stat(join(tempDir, fileName)).catch(() => undefined);

    if (!info || !info.isFile() || info.size === 0) {
      throw new Error(`sitemap publish aborted: shard "${fileName}" is missing or empty.`);
    }
  }
}

/**
 * `outDir` is safe to take over when it does not exist yet, is empty, or
 * already carries {@link OWNERSHIP_MARKER_FILE} from a previous publish.
 * Anything else — a non-empty directory this package never wrote — is
 * refused rather than swapped or deleted (`de97020e`).
 */
async function assertOutDirIsOwned(outDir: string): Promise<void> {
  const entries = await readdir(outDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });

  if (entries === undefined || entries.length === 0) return;

  if (!entries.includes(OWNERSHIP_MARKER_FILE)) {
    throw new UnownedOutputDirectoryError(outDir);
  }
}

/**
 * Writes a complete set into a sibling temp directory, validates that every
 * file it named actually exists and is non-empty, then swaps it into
 * `outDir`. A crawler arriving mid-write sees the previous complete set or
 * the new one, never a partial one, and a failed run leaves the previous set
 * untouched and rejects.
 *
 * `write` performs the writes and returns the file names (relative to the
 * temp dir) that must be present for the set to be considered valid — it is
 * only known after writing, since shard count depends on what was walked.
 */
export async function publishAtomically(
  outDir: string,
  write: (tempDir: string) => Promise<readonly string[]>,
): Promise<void> {
  await assertOutDirIsOwned(outDir);

  const parent = dirname(outDir);

  await mkdir(parent, { recursive: true });

  const tempDir = join(parent, `.${basename(outDir)}.tmp-${process.pid}-${Date.now()}`);

  await mkdir(tempDir, { recursive: true });

  try {
    const fileNames = await write(tempDir);

    await validateShards(tempDir, fileNames);

    await writeFile(
      join(tempDir, OWNERSHIP_MARKER_FILE),
      JSON.stringify({ package: "@warlock.js/sitemap", version: OWNERSHIP_MARKER_VERSION }),
      "utf8",
    );

    const displacedDir = join(parent, `.${basename(outDir)}.previous-${Date.now()}`);
    let displacedPrevious = false;

    try {
      await rename(outDir, displacedDir);
      displacedPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    try {
      await rename(tempDir, outDir);
    } catch (error) {
      if (displacedPrevious) await rename(displacedDir, outDir);
      throw error;
    }

    if (displacedPrevious) await rm(displacedDir, { recursive: true, force: true });
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}
