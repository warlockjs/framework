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

export * from "./atomic.js";
export * from "./copy.js";
export * from "./dirs.js";
export * from "./exists.js";
export * from "./hash.js";
export * from "./list.js";
export * from "./read.js";
export * from "./remove.js";
export * from "./rename.js";
export * from "./stats.js";
export * from "./write.js";
