#!/usr/bin/env node
/**
 * Writes `ui/dashboard/build-info.json` after `vite build`: the hash of the
 * dashboard's sources and, per built file, its size, gzipped size and
 * SHA-256. The release gate (`tools/release/scripts/devtools-ui-gate.ts`)
 * compares it with the sources and a fresh build.
 *
 * Owner: WP-8 (stub from the scaffold).
 */
console.error("write-build-info.mjs is not implemented yet.");
process.exit(1);
