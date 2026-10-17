/**
 * Workspace resolution shim for `@warlock.js/core/tooling`.
 *
 * Core declares no `exports` map, so inside this repository TypeScript and
 * Vite/vitest resolve a deep specifier by path: `@warlock.js/core/tooling`
 * finds this file. The PUBLISHED package does not ship it — pkgist builds
 * `src/tooling/index.ts` as its own entry and generates the `./tooling` export
 * (tools/release/pkgist.config.ts). Keep this a single re-export.
 */
export * from "../src/tooling";
