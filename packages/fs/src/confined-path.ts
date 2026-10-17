import path from "node:path";
import { FsPathEscapeError } from "./confined-errors";

/** Windows device names that open a device instead of a file, in any folder. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/**
 * Split a caller's root-relative path into normalised segments, refusing
 * anything that could leave the root before the file system is touched:
 *
 * - absolute paths (`/x`; on Windows also `C:\x`, `\\server\share`, `\\?\…`)
 *   and Windows drive-relative paths (`C:x`);
 * - a `..` that climbs above the root after normalisation (`a/../b` is fine
 *   and becomes `b`; `a/../../b` is refused);
 * - NUL bytes, and on Windows `:` (alternate data streams), reserved device
 *   names such as `CON` or `nul.txt`, and segments ending in `.` or a space
 *   (Win32 strips those, so the name would not be the one checked).
 *
 * `/` always separates segments; on Windows `\` does too. On POSIX a `\` is
 * an ordinary file-name character. `""` and `"."` mean the root itself (an
 * empty array).
 *
 * `..` is resolved lexically, before any lookup: `link/../x` means `x` in the
 * root, never the parent of the link's target.
 *
 * @param input - The path as the caller passed it.
 * @param root - The reader's root, for the error.
 * @param platform - Which platform's rules apply (defaults to the current one).
 */
export function normalizeConfinedPath(
  input: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const windows = platform === "win32";

  if (typeof input !== "string") {
    throw new TypeError(`confined reader: path must be a string, got ${typeof input}`);
  }

  if (input.includes("\0")) {
    throw new FsPathEscapeError(input, root, "invalid", `Path "${input}" contains a NUL byte.`);
  }

  const absolute = windows
    ? path.win32.isAbsolute(input) || /^[a-zA-Z]:/.test(input)
    : path.posix.isAbsolute(input);

  if (absolute) {
    throw new FsPathEscapeError(
      input,
      root,
      "absolute",
      `Path "${input}" is absolute; a confined reader only accepts paths relative to its root.`,
    );
  }

  const segments: string[] = [];

  for (const segment of input.split(windows ? /[\\/]/ : "/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        throw new FsPathEscapeError(
          input,
          root,
          "parent-traversal",
          `Path "${input}" climbs above the confined root.`,
        );
      }

      segments.pop();
      continue;
    }

    if (windows) {
      // Win32 silently drops trailing dots and spaces from a segment, so a
      // name ending in one (`...`, `secret.txt.`) does not mean what it
      // says, and `CON .txt` still names the device: refuse both.
      const stem = segment.split(".")[0]?.trimEnd() ?? "";

      if (segment.includes(":") || /[. ]$/.test(segment) || WINDOWS_DEVICE_NAME.test(stem)) {
        throw new FsPathEscapeError(
          input,
          root,
          "invalid",
          `Path "${input}" names a Windows device or alternate data stream.`,
        );
      }
    }

    segments.push(segment);
  }

  return segments;
}

/**
 * Whether the absolute path `child` is `root` or lies beneath it. Compares
 * path segments, so `/srv/app-evil` is not inside `/srv/app`, and a file
 * literally named `..data` inside the root is.
 */
export function isPathInside(child: string, root: string): boolean {
  const relative = path.relative(root, child);

  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
