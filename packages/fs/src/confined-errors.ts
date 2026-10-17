/**
 * Why a {@link FsPathEscapeError} was thrown:
 *
 * - `absolute` — the path was absolute (`/etc/passwd`, `C:\Windows`,
 *   `\\server\share`) or drive-relative (`C:file`, Windows only).
 * - `parent-traversal` — after normalisation, a `..` segment climbs above the
 *   root (`../secret`, `a/../../secret`).
 * - `invalid` — the path contains a NUL byte, or (Windows) a `:` (alternate
 *   data stream), a reserved device name (`CON`, `NUL`, `COM1`, …) or a
 *   segment ending in `.` or a space.
 * - `link-escape` — with `followLinks: true`, a link resolves outside the root.
 */
export type FsPathEscapeReason = "absolute" | "parent-traversal" | "invalid" | "link-escape";

/**
 * Thrown by a confined reader when a requested path would leave its root.
 * Nothing is read when this is thrown.
 */
export class FsPathEscapeError extends Error {
  public readonly type = "path-escape" as const;

  public constructor(
    /** The path exactly as the caller passed it. */
    public readonly path: string,
    /** The reader's canonical root. */
    public readonly root: string,
    public readonly reason: FsPathEscapeReason,
    message: string,
  ) {
    super(message);
    this.name = "FsPathEscapeError";
  }
}

/**
 * Why a {@link FsLinkRefusedError} was thrown:
 *
 * - `symlink` — a component of the path is a symbolic link (or a Windows
 *   junction, which Node reports as one) and the reader does not follow links.
 * - `root-symlink` — the root itself is a symbolic link and
 *   `allowSymlinkedRoot` was not set, or the root was replaced by one later.
 * - `identity-changed` — the entry opened is not the entry that was checked:
 *   its device/inode changed between the `lstat` and the open (or around a
 *   directory read). Something swapped it, typically for a link.
 */
export type FsLinkRefusedReason = "symlink" | "root-symlink" | "identity-changed";

/**
 * Thrown by a confined reader when it meets a link it will not follow, or when
 * an entry changed identity between the check and the read. Nothing is
 * returned from the refused entry.
 */
export class FsLinkRefusedError extends Error {
  public readonly type = "link-refused" as const;

  public constructor(
    /** The path exactly as the caller passed it (or the root, for `root-symlink`). */
    public readonly path: string,
    /** The reader's canonical root (the path given, for `root-symlink` at creation). */
    public readonly root: string,
    /** Root-relative, `/`-separated path of the component that was refused. */
    public readonly linkPath: string,
    public readonly reason: FsLinkRefusedReason,
    message: string,
  ) {
    super(message);
    this.name = "FsLinkRefusedError";
  }
}

/** Which bound a {@link FsLimitExceededError} hit. */
export type FsLimit = "maxFileBytes" | "maxEntries" | "maxDepth";

/**
 * Thrown by a confined reader when a read goes over one of its bounds: a file
 * larger than `maxFileBytes` (checked while reading, not only from `stat`), a
 * `list`/`walk` that reads more than `maxEntries` entries, or a `walk` that
 * would descend deeper than `maxDepth`.
 */
export class FsLimitExceededError extends Error {
  public readonly type = "limit-exceeded" as const;

  public constructor(
    /** Root-relative, `/`-separated path of the file or directory being read. */
    public readonly path: string,
    public readonly limit: FsLimit,
    /** The configured bound. */
    public readonly max: number,
    /** What was reached when the read stopped (at least `max + 1`). */
    public readonly actual: number,
    message: string,
  ) {
    super(message);
    this.name = "FsLimitExceededError";
  }
}

/** Any error a confined reader throws on purpose, discriminated by `type`. */
export type FsConfinedError = FsPathEscapeError | FsLinkRefusedError | FsLimitExceededError;
