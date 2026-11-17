#!/usr/bin/env node
/**
 * Writes `ui/dashboard/build-info.json` after `vite build` (the `build:ui`
 * script): the source hash of the dashboard, the gzip budget, and for each
 * shipped file its size, gzipped size and SHA-256. The release gate
 * (`tools/release/scripts/devtools-ui-gate.ts`) checks this file against the
 * sources and against a fresh build.
 *
 * Usage: `node ui-src/scripts/write-build-info.mjs [--out <dir>]`
 * (default `<package>/ui/dashboard`; a relative `--out` is taken from the
 * current directory). Exits 1 when the bundle is not exactly one HTML file,
 * one JS file and one CSS file.
 *
 * Owner: WP-8.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { dashboardSourceHash } from "./source-hash.mjs";

/** The gzipped budget for `assets/app.js` + `assets/app.css`: 300 KB. */
export const DASHBOARD_GZIP_BUDGET_BYTES = 307200;

/** The only files the dashboard ships. The asset whitelist in the server depends on these names. */
export const DASHBOARD_FILES = ["index.html", "assets/app.js", "assets/app.css"];

const ASSET_FILES = ["app.js", "app.css"];

function fileRecord(content) {
  return {
    bytes: content.length,
    gzipBytes: gzipSync(content, { level: 9 }).length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

/** Throws with a message naming the problem when the bundle is not the three fixed files. */
async function assertBundleShape(outDir) {
  for (const file of DASHBOARD_FILES) {
    const exists = await stat(path.join(outDir, file)).then(
      (info) => info.isFile(),
      () => false,
    );
    if (!exists) {
      throw new Error(
        `The devtools dashboard build is missing ${file} in ${outDir}. Run vite build first (pnpm --filter @warlock.js/devtools build:ui).`,
      );
    }
  }

  const assetEntries = (await readdir(path.join(outDir, "assets"))).sort();
  const extra = assetEntries.filter((entry) => !ASSET_FILES.includes(entry));
  if (extra.length > 0) {
    throw new Error(
      `The devtools dashboard build has extra files in assets/: ${extra.join(", ")}. The bundle must be one JS file (assets/app.js) and one CSS file (assets/app.css).`,
    );
  }
}

/**
 * Writes `<outDir>/build-info.json` for the dashboard built in `outDir`, with
 * the sources of the package at `packageDir`. Returns the written object.
 */
export async function writeBuildInfo({ packageDir, outDir }) {
  await assertBundleShape(outDir);

  const files = {};
  for (const file of DASHBOARD_FILES) {
    files[file] = fileRecord(await readFile(path.join(outDir, file)));
  }

  const buildInfo = {
    sourceHash: await dashboardSourceHash(packageDir),
    budgetGzipBytes: DASHBOARD_GZIP_BUDGET_BYTES,
    files,
  };
  await writeFile(path.join(outDir, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
  return buildInfo;
}

function parseOutDir(argv, packageDir) {
  const index = argv.indexOf("--out");
  const value = index === -1 ? undefined : argv[index + 1];
  if (index !== -1 && (value === undefined || value.startsWith("--"))) {
    throw new Error("--out needs a directory, for example --out ui/dashboard");
  }
  return path.resolve(value ?? path.join(packageDir, "ui", "dashboard"));
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.resolve(scriptDir, "..", "..");
  const outDir = parseOutDir(process.argv.slice(2), packageDir);
  const buildInfo = await writeBuildInfo({ packageDir, outDir });
  const sizes = Object.entries(buildInfo.files)
    .map(([file, record]) => `${file} ${record.gzipBytes} B gzipped`)
    .join(", ");
  console.log(`devtools dashboard build info written to ${outDir} (${sizes})`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
