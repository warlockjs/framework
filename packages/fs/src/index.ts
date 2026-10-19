/**
 * @warlock.js/fs — filesystem primitives for Warlock.js.
 *
 * Naming conventions:
 *   - `*Async()` — async (returns Promise).
 *   - bare name — synchronous.
 *
 * Canonical names only. The package intentionally exposes a single name per
 * operation; there are no aliases to remember.
 */

export * from "./atomic";
export * from "./confined";
export * from "./confined-errors";
export { isPathInside } from "./confined-path";
export * from "./copy";
export * from "./dirs";
export * from "./exists";
export * from "./hash";
export * from "./list";
export * from "./move-directory";
export * from "./read";
export * from "./remove";
export * from "./rename";
export * from "./stats";
export * from "./write";

// ── Shorthand facade (async) — fs.files.* / fs.dirs.* + File/Directory handles ──
export { fs } from "./facade/fs";
export { File } from "./facade/file";
export { Directory } from "./facade/directory";
export * from "./facade/options";
export {
  JsonSchemaValidationError,
  type StandardSchemaV1,
  type StandardSchemaIssue,
  type StandardSchemaResult,
} from "./facade/standard-schema";

export * from "./transaction";
