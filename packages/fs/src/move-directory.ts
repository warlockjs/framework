import { lstat, mkdir, open, rename, rmdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The `(dev, ino)` pair that identifies a directory independently of its path.
 */
export type DirectoryIdentity = {
  dev: number;
  ino: number;
};

export type MoveDirectoryNoReplaceOptions = {
  /**
   * Refuse unless the source still has this identity (from a previous
   * {@link directoryIdentityAsync} call). The comparison is a sequential
   * check before the rename, not an atomic compare-and-move: no portable
   * platform call offers one.
   */
  expectedSource?: DirectoryIdentity;
  /**
   * `fsync` the source and destination parent directories after the rename,
   * so the move survives a crash. Off by default: without it the move is
   * atomic but its durability is left to the filesystem.
   *
   * @default false
   */
  syncParents?: boolean;
};

/**
 * A completed move. `identity` is the moved directory's `(dev, ino)`, verified
 * at the destination after the rename.
 */
export type MoveDirectoryNoReplaceResult = {
  type: "moved";
  from: string;
  to: string;
  identity: DirectoryIdentity;
  /** `true` when both parent directories were fsynced (`syncParents`). */
  synced: boolean;
};

/**
 * What the caller can rely on after a failed move:
 *
 * - `not-moved` — this call did not move the directory: nothing of the
 *   source is at the destination, and whatever was at the destination was
 *   not replaced. For most reasons the source is still where it was; for
 *   `source-missing` and `source-identity-mismatch` another process removed
 *   or swapped it, so read the source path again before retrying.
 * - `moved` — the directory is at the destination, but a later step failed
 *   (only `sync-failed`: durability is unknown).
 * - `uncertain` — neither location could be verified; inspect both paths.
 *
 * When the move stopped after the destination name was claimed and the empty
 * placeholder could not be removed, `placeholderCleanupError` holds the
 * reason and the message says so: an empty directory is left at the
 * destination, and a retry will report `destination-exists` until it is
 * removed.
 */
export type DirectoryMoveOutcome = "not-moved" | "moved" | "uncertain";

export type DirectoryMoveFailure =
  | "unsupported-platform"
  | "invalid-destination"
  | "source-missing"
  | "source-not-directory"
  | "source-identity-mismatch"
  | "destination-exists"
  | "destination-parent-missing"
  | "placeholder-replaced"
  | "cross-device"
  | "rename-failed"
  | "sync-failed";

/**
 * Thrown by {@link moveDirectoryNoReplaceAsync}. `outcome` says what is known
 * about the directory's location; `reason` says why the move stopped.
 */
export class DirectoryMoveError extends Error {
  /**
   * Set when the empty placeholder this call created at the destination could
   * not be removed after the move stopped (see {@link DirectoryMoveOutcome}).
   */
  public placeholderCleanupError?: unknown;

  public constructor(
    public readonly reason: DirectoryMoveFailure,
    public readonly outcome: DirectoryMoveOutcome,
    public readonly from: string,
    public readonly to: string,
    message: string,
    cause?: unknown,
  ) {
    super(`moveDirectoryNoReplaceAsync("${from}" → "${to}"): ${message}`, { cause });
    this.name = "DirectoryMoveError";
  }
}

/**
 * Read a directory's `(dev, ino)` identity without following a symlink.
 * Pass it back as `expectedSource` to refuse a move whose source was swapped.
 */
export async function directoryIdentityAsync(directoryPath: string): Promise<DirectoryIdentity> {
  const stats = await lstat(directoryPath);

  if (!stats.isDirectory()) {
    throw new Error(`directoryIdentityAsync: "${directoryPath}" is not a directory`);
  }

  return { dev: stats.dev, ino: stats.ino };
}

/**
 * Move a directory to a destination that must not exist, refusing atomically
 * when it does — never replacing anything there, and never falling back to
 * copy + delete.
 *
 * An ordinary `rename()` silently replaces an empty directory at the
 * destination, and a check-then-rename leaves a window for one to appear.
 * Node exposes no `renameat2(RENAME_NOREPLACE)`, so this claims the
 * destination name first with an exclusive, non-recursive `mkdir` (atomic:
 * it fails with `EEXIST` when anything holds the name), then renames the
 * source over that empty placeholder it owns:
 *
 * - a destination occupied before the call → `destination-exists`, nothing touched;
 * - an entry written into the placeholder meanwhile → the rename fails
 *   (`ENOTEMPTY`) → `destination-exists`, the entry is kept;
 * - a placeholder replaced by another directory after its identity was
 *   recorded → `placeholder-replaced` (identity re-checked just before the
 *   rename).
 *
 * Limits, stated plainly: Node's `mkdir` returns no descriptor, so the
 * placeholder's identity is read by a separate `lstat` right after the claim.
 * A process that does not use this API and swaps the placeholder for its own
 * empty directory in that instant, or between the last identity check and the
 * rename, is not detected, and its directory would be replaced. The empty
 * placeholder is briefly visible at the destination; the source identity
 * check is sequential, not atomic. Path components are resolved by path, not
 * by pinned directory descriptors (Node offers none).
 *
 * Refuses explicitly on Windows (directory renames there are not POSIX
 * renames) and across devices — the source and destination parent must share
 * a filesystem. The destination parent must exist; it may be a symlink to a
 * directory (its target's device is the one compared).
 *
 * @throws {DirectoryMoveError} with `outcome` (`not-moved` / `moved` /
 *   `uncertain`) and `reason`.
 *
 * @example
 * const identity = await directoryIdentityAsync("features/billing");
 * await moveDirectoryNoReplaceAsync("features/billing", "archive/billing-2026", {
 *   expectedSource: identity,
 *   syncParents: true,
 * });
 */
export async function moveDirectoryNoReplaceAsync(
  from: string,
  to: string,
  options: MoveDirectoryNoReplaceOptions = {},
): Promise<MoveDirectoryNoReplaceResult> {
  const source = path.resolve(from);
  const destination = path.resolve(to);
  const fail = (
    reason: DirectoryMoveFailure,
    outcome: DirectoryMoveOutcome,
    message: string,
    cause?: unknown,
  ) => new DirectoryMoveError(reason, outcome, from, to, message, cause);

  if (process.platform === "win32") {
    throw fail(
      "unsupported-platform",
      "not-moved",
      "atomic no-replace directory moves are not supported on Windows",
    );
  }

  const relative = path.relative(source, destination);

  if (relative === "" || (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative))) {
    throw fail("invalid-destination", "not-moved", "the destination is the source or inside it");
  }

  const sourceIdentity = await readSourceIdentity(source, options.expectedSource, fail);

  // Follow a symlink here: a parent such as macOS `/tmp` (→ `/private/tmp`)
  // or a deploy `current` → `releases/N` link is a real directory, and the
  // device that matters for the rename is the one it points at.
  const destinationParent = await statOrUndefined(path.dirname(destination));

  if (!destinationParent?.isDirectory()) {
    throw fail(
      "destination-parent-missing",
      "not-moved",
      "the destination's parent directory does not exist",
    );
  }

  if (destinationParent.dev !== sourceIdentity.dev) {
    throw fail(
      "cross-device",
      "not-moved",
      "the source and destination are on different filesystems",
    );
  }

  // Claim the destination name. Non-recursive mkdir is atomic: it fails when
  // anything — file, directory, symlink — already holds the name.
  try {
    await mkdir(destination);
  } catch (error) {
    const code = errorCode(error);

    if (code === "EEXIST") {
      throw fail("destination-exists", "not-moved", "the destination already exists", error);
    }

    if (code === "ENOENT" || code === "ENOTDIR") {
      throw fail(
        "destination-parent-missing",
        "not-moved",
        "the destination's parent directory does not exist",
        error,
      );
    }

    throw fail("rename-failed", "not-moved", "could not claim the destination", error);
  }

  const placeholder = await identityOf(destination);

  // Sequential re-checks right before the rename: the source must not have
  // been swapped, and the placeholder must still be ours.
  const currentSource = await identityOf(source);

  if (!currentSource || !sameIdentity(currentSource, sourceIdentity)) {
    throw withCleanup(
      fail(
        "source-identity-mismatch",
        "not-moved",
        "the source changed while the destination was being claimed",
      ),
      await removePlaceholder(destination, placeholder),
    );
  }

  const currentPlaceholder = await identityOf(destination);

  if (!placeholder || !currentPlaceholder || !sameIdentity(currentPlaceholder, placeholder)) {
    throw fail(
      "placeholder-replaced",
      "not-moved",
      "another process replaced the claimed destination",
    );
  }

  try {
    await rename(source, destination);
  } catch (error) {
    throw await classifyRenameFailure(
      error,
      source,
      destination,
      sourceIdentity,
      placeholder,
      fail,
    );
  }

  const moved = await identityOf(destination);

  if (!moved || !sameIdentity(moved, sourceIdentity)) {
    throw fail(
      "rename-failed",
      "uncertain",
      "the rename returned but the destination does not hold the source directory",
    );
  }

  let synced = false;

  if (options.syncParents) {
    try {
      await syncDirectory(path.dirname(source));

      if (path.dirname(source) !== path.dirname(destination)) {
        await syncDirectory(path.dirname(destination));
      }

      synced = true;
    } catch (error) {
      throw fail(
        "sync-failed",
        "moved",
        "the directory was moved but its parent directories could not be synced",
        error,
      );
    }
  }

  return { type: "moved", from: source, to: destination, identity: sourceIdentity, synced };
}

type Fail = (
  reason: DirectoryMoveFailure,
  outcome: DirectoryMoveOutcome,
  message: string,
  cause?: unknown,
) => DirectoryMoveError;

async function readSourceIdentity(
  source: string,
  expected: DirectoryIdentity | undefined,
  fail: Fail,
): Promise<DirectoryIdentity> {
  const stats = await lstatOrUndefined(source);

  if (!stats) {
    throw fail("source-missing", "not-moved", "the source does not exist");
  }

  if (!stats.isDirectory()) {
    throw fail(
      "source-not-directory",
      "not-moved",
      stats.isSymbolicLink()
        ? "the source is a symbolic link, not a directory"
        : "the source is not a directory",
    );
  }

  const identity = { dev: stats.dev, ino: stats.ino };

  if (expected && !sameIdentity(identity, expected)) {
    throw fail("source-identity-mismatch", "not-moved", "the source is not the expected directory");
  }

  return identity;
}

async function classifyRenameFailure(
  error: unknown,
  source: string,
  destination: string,
  sourceIdentity: DirectoryIdentity,
  placeholder: DirectoryIdentity | undefined,
  fail: Fail,
): Promise<DirectoryMoveError> {
  const code = errorCode(error);
  const atSource = await identityOf(source);
  const atDestination = await identityOf(destination);

  if (atDestination && sameIdentity(atDestination, sourceIdentity)) {
    return fail("rename-failed", "moved", "the rename reported an error after moving", error);
  }

  if (!atSource || !sameIdentity(atSource, sourceIdentity)) {
    // The destination still holds our own empty placeholder, so the rename
    // certainly did not land there: another process removed or swapped the
    // source just before it. Release the claim so a retry is not blocked.
    if (placeholder && atDestination && sameIdentity(atDestination, placeholder)) {
      return withCleanup(
        fail(
          "source-identity-mismatch",
          "not-moved",
          "the source was removed or replaced just before the rename",
          error,
        ),
        await removePlaceholder(destination, placeholder),
      );
    }

    return fail(
      "rename-failed",
      "uncertain",
      "the rename failed and the source is no longer where it was",
      error,
    );
  }

  // The source is still in place: nothing moved. Release our claim when the
  // placeholder is still ours and empty (rmdir refuses a non-empty one).
  const cleanupError = await removePlaceholder(destination, placeholder);

  if (code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOTDIR") {
    // rmdir refused a placeholder another process wrote into: expected, the
    // entry is theirs and is kept.
    return fail(
      "destination-exists",
      "not-moved",
      "another process wrote into the destination while it was claimed",
      error,
    );
  }

  if (code === "EXDEV") {
    return withCleanup(
      fail(
        "cross-device",
        "not-moved",
        "the source and destination are on different filesystems",
        error,
      ),
      cleanupError,
    );
  }

  return withCleanup(fail("rename-failed", "not-moved", "the rename failed", error), cleanupError);
}

/**
 * Remove the empty placeholder this call created, if the destination still
 * holds it. Returns the `rmdir` error when removal failed, so the caller can
 * report the leftover instead of hiding it.
 */
async function removePlaceholder(
  destination: string,
  placeholder: DirectoryIdentity | undefined,
): Promise<unknown> {
  const current = await identityOf(destination);

  if (!placeholder || !current || !sameIdentity(current, placeholder)) {
    return undefined;
  }

  try {
    await rmdir(destination);
    return undefined;
  } catch (error) {
    return error ?? new Error("rmdir failed");
  }
}

/**
 * Attach a failed placeholder cleanup to the error: the caller must learn that
 * an empty directory was left at the destination.
 */
function withCleanup(error: DirectoryMoveError, cleanupError: unknown): DirectoryMoveError {
  if (cleanupError === undefined) return error;

  error.placeholderCleanupError = cleanupError;

  const reason = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  error.message += ` (the empty placeholder left at the destination could not be removed: ${reason})`;

  return error;
}

async function syncDirectory(directoryPath: string) {
  const handle = await open(directoryPath, "r");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function statOrUndefined(target: string) {
  try {
    return await stat(target);
  } catch {
    return undefined;
  }
}

async function lstatOrUndefined(target: string) {
  try {
    return await lstat(target);
  } catch {
    return undefined;
  }
}

async function identityOf(target: string): Promise<DirectoryIdentity | undefined> {
  const stats = await lstatOrUndefined(target);

  return stats?.isDirectory() ? { dev: stats.dev, ino: stats.ino } : undefined;
}

function sameIdentity(a: DirectoryIdentity, b: DirectoryIdentity) {
  return a.dev === b.dev && a.ino === b.ino;
}

function errorCode(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
