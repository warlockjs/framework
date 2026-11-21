/**
 * The book (owned by T-127): collecting the adapter's facts with a freshness
 * fingerprint, the route cache, and writing the per-file mirror, the module
 * summaries, `app/routes.json` and the page and screen lists.
 *
 * Freshness rules:
 * - `buildBook` stats every file under the adapter's source roots (and the test
 *   files); a file whose size and mtime match the manifest keeps its hash,
 *   others are hashed. When the file set and hashes, the adapter name and
 *   version, the grimoire version and the schema version all match, the
 *   adapter is not called and nothing is written (`rebuilt: false`).
 * - Otherwise `files`, `sites`, `pages`, `mobile` and `tests` are collected
 *   again (all static).
 * - `routes` and `named` (the boot facts) are collected only when the caller
 *   asked for `routes: "fresh"` and an input of the boot cache changed (see
 *   `BookManifest.boot`); with `cached` the old ones are kept and reported
 *   `stale`.
 */
export { buildBook, checkBook, defaultRouteInputs, loadBook, type BookCheck } from "./build";
export { packagesOf, renderModuleSummary } from "./render";
export { writeBook } from "./write";
