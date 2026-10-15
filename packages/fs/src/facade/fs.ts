import { pathExistsAsync } from "../exists";
import { hashBuffer, hashFileAsync, hashString, type HashAlgorithm } from "../hash";
import { Directory } from "./directory";
import { dirs } from "./dirs";
import { File } from "./file";
import { files } from "./files";

/**
 * The `fs` shorthand facade — an async, ergonomic surface over
 * `@warlock.js/fs`'s primitives:
 *
 * - `fs.files.*` — file operations
 * - `fs.dirs.*` — directory operations
 * - `fs.file(path)` / `fs.dir(path)` — lazy `File` / `Directory` handles
 * - `fs.exists(path)` — type-agnostic existence (file OR directory)
 *
 * Async-only by design: synchronous callers use the bare primitives
 * (`getFile` / `putFile` / …), which keep the package's `bare = sync`,
 * `*Async = async` charter. `fs.*` never sandboxes paths — path containment is
 * the storage layer's job.
 *
 * @example
 * import { fs } from "@warlock.js/fs";
 *
 * await fs.files.put("cache/data.json", "{}", { atomic: true });
 * const cfg = await fs.files.getJson("config.json", { schema, default: {} });
 * const dir = fs.dir("uploads");
 * if (await dir.isEmpty()) { ... }
 */
export const fs = {
  files,
  dirs,

  /**
   * Hashing — `file`/`dir` are async (they read from disk); `string`/`buffer`
   * are sync (pure, in-memory — no IO to await). Defaults to SHA-256.
   */
  hash: {
    file: (path: string, algorithm?: HashAlgorithm): Promise<string> =>
      hashFileAsync(path, algorithm),
    dir: (path: string, algorithm?: HashAlgorithm): Promise<string> => dirs.hash(path, algorithm),
    string: (content: string, algorithm?: HashAlgorithm): string => hashString(content, algorithm),
    buffer: (content: Buffer | Uint8Array, algorithm?: HashAlgorithm): string =>
      hashBuffer(content, algorithm),
  },

  /** Does anything exist at this path (file OR directory)? */
  exists(path: string): Promise<boolean> {
    return pathExistsAsync(path);
  },

  /** A lazy handle to a file path (no IO until a method is called). */
  file(path: string): File {
    return new File(path);
  },

  /** A lazy handle to a directory path (no IO until a method is called). */
  dir(path: string): Directory {
    return new Directory(path);
  },
};
