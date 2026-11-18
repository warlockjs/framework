import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { MountedPanelFiles } from "../panels";

/** The longest request path a panel's file route looks at. */
const MAX_PATH_LENGTH = 512;

/**
 * Resolves a request path inside a panel's folder of images, or `null` when
 * it must answer 404. The path is the one URL decoding left (decoded once);
 * it is refused when it is empty, absolute, has an empty, `.` or `..`
 * segment, a backslash, a colon or a NUL byte, or an extension the panel did
 * not list. The resolved file must be a regular file whose real path (links
 * followed) stays inside the real path of the folder.
 */
export async function resolvePanelFile(
  files: MountedPanelFiles,
  requested: unknown,
): Promise<string | null> {
  if (typeof requested !== "string" || requested === "" || requested.length > MAX_PATH_LENGTH) {
    return null;
  }

  if (/[\0\\:]/.test(requested) || requested.startsWith("/")) return null;

  const segments = requested.split("/");

  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }

  const extension = path.extname(segments[segments.length - 1] ?? "").toLowerCase();

  if (!files.extensions.includes(extension)) return null;

  try {
    const root = await realpath(files.dir);
    const real = await realpath(path.join(root, ...segments));

    if (!real.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return null;

    // A link inside the folder must not turn an image name into another kind of file.
    if (!files.extensions.includes(path.extname(real).toLowerCase())) return null;

    return (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}
