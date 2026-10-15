/**
 * Workspace resolution shim for `@warlock.js/core/errors` (WR-017).
 *
 * Core declares no `exports` map, so inside this repository TypeScript and
 * Vite/vitest resolve a deep specifier by path: `@warlock.js/core/errors`
 * finds this file. The PUBLISHED package does not ship it — pkgist builds
 * `src/errors/index.ts` as its own entry and generates the `./errors` export
 * (tools/release/pkgist.config.ts). Keep this a single re-export.
 */
export * from "../src/errors";
