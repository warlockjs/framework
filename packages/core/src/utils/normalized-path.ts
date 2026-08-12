import path from "node:path";

/**
 * Path helpers that always hand back forward slashes.
 *
 * Node's `path` returns `\` on Windows, and these values are compared against
 * module specifiers, glob results and map keys — all of which use `/`. A raw
 * `path.relative()` therefore produces a string that looks right in a log and
 * fails every lookup it is used for.
 *
 * This lived under `dev-server/` and was imported from there by production
 * modules (`connectors`, `database`, `config`), which put the whole dev-server
 * directory into the production module graph. The code was never dev-only —
 * only its location was.
 */
export class Path {
  /**
   * Convert the given absolute path to a relative path
   */
  public static toRelative(absolutePath: string) {
    return this.normalize(path.relative(process.cwd(), absolutePath));
  }

  /**
   * Get relative path of the given path
   */
  public static relative(relativePath: string) {
    return this.normalize(path.relative(process.cwd(), relativePath));
  }

  /**
   * Get normalized absolute path of the given path
   */
  public static toNormalizedAbsolute(relativePath: string) {
    return this.normalize(path.resolve(process.cwd(), relativePath));
  }

  /**
   * Get absolute path of the given path
   */
  public static toAbsolute(relativePath: string) {
    return this.normalize(path.resolve(process.cwd(), relativePath));
  }

  /**
   * Normalize the given path (convert backslashes to forward slashes)
   */
  public static normalize(filePath: string) {
    return filePath.replace(/\\/g, "/");
  }

  /**
   * Join paths and normalize
   */
  public static join(...paths: string[]) {
    return this.normalize(path.join(...paths));
  }

  /**
   * Get directory name of a path
   */
  public static dirname(filePath: string) {
    return this.normalize(path.dirname(filePath));
  }

  /**
   * Get base name of a path
   */
  public static basename(filePath: string, ext?: string) {
    return path.basename(filePath, ext);
  }

  /**
   * Get extension of a path
   */
  public static extname(filePath: string) {
    return path.extname(filePath);
  }
}
