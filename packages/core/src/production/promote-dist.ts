import { directoryExistsAsync, removeDirectoryAsync, renameFileAsync } from "@warlock.js/fs";
import { randomBytes } from "crypto";
import path from "path";

/**
 * A sibling of `outDir` that esbuild bundles into instead of the real output
 * directory. Same parent folder as `outDir` on purpose — {@link stageDistAsync}
 * moves it into place with a directory rename, and a rename only stays a
 * single atomic filesystem operation when source and destination share a
 * volume.
 *
 * This path is a WRITE TARGET and nothing else. It is never written back into
 * the build config: `options.outdir` names the FINAL destination at all times,
 * because consumers bake it into runtime output (the web contribution derives
 * its `clientDir` from it) and a runtime path pointing at a temp directory
 * that promotion renames away is a broken artifact, not a broken build.
 */
export function createTempOutputDir(outDir: string): string {
  const parent = path.dirname(outDir);
  const base = path.basename(outDir);
  const suffix = randomBytes(6).toString("hex");

  return path.join(parent, `.${base}.build-${suffix}`);
}

/**
 * A promotion in flight: the temp build has been renamed onto `outDir`, and
 * the previous `outDir` (when there was one) is parked under `previousDir`
 * until the caller {@link commitDistAsync commits} or
 * {@link rollbackDistAsync rolls back}.
 */
export type StagedDist = {
  /** The real output directory (`dist`) the temp build now occupies */
  outDir: string;
  /**
   * The moved-aside previous build, or `undefined` when `outDir` did not
   * exist before staging — the marker for "a rollback has nothing to restore,
   * it only has to remove what this build put there".
   */
  previousDir?: string;
};

/**
 * Move a freshly-built temp directory into place as `outDir`, replacing
 * whatever was there — without ever leaving `outDir` a mix of old and new
 * files, and without discarding the previous build yet.
 *
 * `fs.rename` moves a directory as a single filesystem operation, so each
 * rename below is atomic: `outDir` is observed as either wholly the old
 * build, wholly the new one, or (only for the instant between the two
 * renames below, and only when one previously existed) briefly absent —
 * never a mix of the two.
 *
 * Windows refuses to rename a directory onto a path that already exists, so
 * an existing `outDir` is moved aside first and only deleted by
 * {@link commitDistAsync}, once the build that follows has finished writing
 * into the new one. If the second rename throws — the only realistic way our
 * own code could leave `outDir` missing, as opposed to the process being
 * killed at the exact wrong instant — the old directory is moved straight
 * back before the error propagates, so a failed promotion never costs the
 * previous good build.
 *
 * Staging is deliberately separate from committing. The steps that run
 * between them — connector `emit` hooks, and the build-success marker — need
 * `outDir` to be the REAL path while they run, because what they write bakes
 * that path into the artifact. Renaming first and committing last is what
 * lets them see the final path and still be undone as a unit.
 *
 * @param tempDir the freshly-built directory to promote (removed as a side
 * effect of the rename; the caller does not need to clean it up once this
 * resolves)
 * @param outDir the real output directory (`dist`) to replace
 */
export async function stageDistAsync(tempDir: string, outDir: string): Promise<StagedDist> {
  const previousExists = await directoryExistsAsync(outDir);

  if (!previousExists) {
    await renameFileAsync(tempDir, outDir);

    return { outDir };
  }

  const previousDir = `${outDir}.stale-${randomBytes(6).toString("hex")}`;

  await renameFileAsync(outDir, previousDir);

  try {
    await renameFileAsync(tempDir, outDir);
  } catch (error) {
    await renameFileAsync(previousDir, outDir).catch(() => undefined);
    throw error;
  }

  return { outDir, previousDir };
}

/**
 * Finish a staged promotion: the new `dist` is complete, so the parked
 * previous build is no longer needed.
 *
 * Never throws. It is the last step of a build that has already succeeded,
 * and a leftover `dist.stale-*` directory is untidy, not incorrect — failing
 * the build over it would turn a good artifact into a red run.
 */
export async function commitDistAsync(staged: StagedDist): Promise<void> {
  if (!staged.previousDir) return;

  await removeDirectoryAsync(staged.previousDir).catch(() => undefined);
}

/**
 * Undo a staged promotion after a later step failed: put the previous build
 * back where it was, and take the half-finished one out of `dist`.
 *
 * The failed build is renamed aside before the previous one is renamed back,
 * for the same reason {@link stageDistAsync} moves the old directory aside
 * first: a recursive delete of `dist` would leave it observable as a partial
 * tree, while a rename does not.
 *
 * Never throws. It runs inside a `catch`, and the error it is unwinding is
 * the one the developer needs to see — a rollback failure must not replace
 * it. The worst case it can leave behind is a `dist` holding an incomplete
 * build with no build-success marker, which `warlock start` refuses by
 * definition.
 */
export async function rollbackDistAsync(staged: StagedDist): Promise<void> {
  const { outDir, previousDir } = staged;

  if (!previousDir) {
    await removeDirectoryAsync(outDir).catch(() => undefined);

    return;
  }

  const discardDir = `${outDir}.failed-${randomBytes(6).toString("hex")}`;

  await renameFileAsync(outDir, discardDir).catch(() => undefined);
  await renameFileAsync(previousDir, outDir).catch(() => undefined);
  await removeDirectoryAsync(discardDir).catch(() => undefined);
}
