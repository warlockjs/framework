// @ts-check
/**
 * Generate https://warlock.js.org/release-notes.json from the repository's
 * `releases/<version>-summary.md` files: the same markdown `@warlock.js/core`
 * bundles, so `warlock release-notes` can show an app releases newer than the
 * one it has installed.
 *
 * Shape: { generatedAt, latest, releases: [{ version, publishedAt?, summary }] },
 * oldest first. `publishedAt` comes from src/data/releases.json when present.
 *
 * Output lands in public/, which Astro copies verbatim to the dist root.
 *   node scripts/generate-release-notes.mjs
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(here, "..");
const RELEASES_DIR = resolve(DOCS_ROOT, "..", "releases");
const RELEASES_META = resolve(DOCS_ROOT, "src/data/releases.json");
const OUT_FILE = resolve(DOCS_ROOT, "public/release-notes.json");

const SUMMARY_FILE = /^(\d+)\.(\d+)\.(\d+)-summary\.md$/;

/**
 * @param {string} releasesDir folder holding the summary files
 * @param {Record<string, { publishedAt?: string }>} meta release metadata by version
 * @param {string} [generatedAt]
 */
export async function buildReleaseNotes(releasesDir, meta = {}, generatedAt = new Date().toISOString()) {
  const names = (await readdir(releasesDir))
    .map((name) => ({ name, match: SUMMARY_FILE.exec(name) }))
    .filter((entry) => entry.match)
    .sort((a, b) => {
      for (let index = 1; index <= 3; index++) {
        const diff = Number(a.match?.[index]) - Number(b.match?.[index]);
        if (diff !== 0) return diff;
      }
      return 0;
    });

  const releases = [];

  for (const { name, match } of names) {
    const version = `${match?.[1]}.${match?.[2]}.${match?.[3]}`;
    const summary = (await readFile(resolve(releasesDir, name), "utf8")).replace(/^﻿/, "");
    const publishedAt = meta[version]?.publishedAt;

    releases.push(publishedAt ? { version, publishedAt, summary } : { version, summary });
  }

  return { generatedAt, latest: releases.at(-1)?.version ?? null, releases };
}

async function main() {
  const meta = existsSync(RELEASES_META) ? JSON.parse(await readFile(RELEASES_META, "utf8")) : {};
  const data = await buildReleaseNotes(RELEASES_DIR, meta);

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(data)}\n`);
  console.log(`release-notes.json: ${data.releases.length} releases, latest ${data.latest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
