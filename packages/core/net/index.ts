/**
 * Workspace resolution shim for `@warlock.js/core/net`.
 *
 * Core declares no `exports` map, so inside this repository TypeScript and
 * Vite/vitest resolve a deep specifier by path: `@warlock.js/core/net`
 * finds this file. The PUBLISHED package does not ship it — pkgist builds
 * `src/net/index.ts` as its own entry and generates the `./net` export
 * (tools/release/pkgist.config.ts). Keep this a single re-export.
 */
export * from "../src/net";
