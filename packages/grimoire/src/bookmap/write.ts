/**
 * Writes the collected files. Warlock writes only `index.json` and
 * `*.bookmap.json` files here, never a file an agent wrote.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CollectedFiles } from "../contracts/bookmap";
import { featureBookmapPath, flowBookmapPath, GRIMOIRE_PATHS } from "../paths";

function absolute(root: string, file: string): string {
  return path.join(root, ...file.split("/"));
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** Write through a temporary file and a rename, so a reader (the devtools tab) never sees half a file. */
async function writeAtomic(target: string, content: string): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

  try {
    await writeFile(temporary, content);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function listDir(directory: string): Promise<{ name: string; directory: boolean }[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });

    return entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

/** Book map files on disk: `features/<f>/bookmap.json` and `features/<f>/flows/<flow>.bookmap.json`. */
async function existingBookmaps(root: string): Promise<string[]> {
  const found: string[] = [];
  const featuresDir = absolute(root, GRIMOIRE_PATHS.features);

  for (const feature of await listDir(featuresDir)) {
    if (!feature.directory) continue;

    const featureDir = path.join(featuresDir, feature.name);

    for (const entry of await listDir(featureDir)) {
      if (!entry.directory && entry.name === "bookmap.json")
        found.push(featureBookmapPath(feature.name));
    }

    for (const entry of await listDir(path.join(featureDir, "flows"))) {
      if (!entry.directory && entry.name.endsWith(".bookmap.json")) {
        found.push(flowBookmapPath(feature.name, entry.name.slice(0, -".bookmap.json".length)));
      }
    }
  }

  return found;
}

/** Remove a folder when it is empty (a deleted feature leaves only Warlock's files). */
async function removeIfEmpty(directory: string): Promise<void> {
  if ((await listDir(directory)).length > 0) return;

  try {
    await rmdir(directory);
  } catch {
    // Another process wrote into it, or it is gone already.
  }
}

/**
 * Write the collected files under `grimoire/features` and `grimoire/tasks`,
 * only those whose content changed, and remove book maps of features and flows
 * that no longer exist.
 *
 * An index with no entries is written only when its folder exists, so a
 * project without written files gets no `grimoire/features` or
 * `grimoire/tasks` folder.
 *
 * @returns Project-relative files written and removed, sorted.
 */
export async function writeCollectedFiles(
  root: string,
  collected: CollectedFiles,
): Promise<{ written: string[]; removed: string[] }> {
  const wanted = new Map<string, string>();

  for (const map of Object.values(collected.features)) {
    wanted.set(featureBookmapPath(map.feature), json(map));
  }

  for (const map of Object.values(collected.flows)) {
    wanted.set(flowBookmapPath(map.feature, map.flow), json(map));
  }

  const indexes: [string, unknown, boolean][] = [
    [
      GRIMOIRE_PATHS.featuresIndex,
      collected.featuresIndex,
      collected.featuresIndex.features.length + Object.keys(collected.features).length > 0,
    ],
    [
      GRIMOIRE_PATHS.tasksIndex,
      collected.tasksIndex,
      collected.tasksIndex.open.length + collected.tasksIndex.done.length > 0,
    ],
  ];

  for (const [file, value, hasEntries] of indexes) {
    if (hasEntries || existsSync(path.dirname(absolute(root, file)))) wanted.set(file, json(value));
  }

  const written: string[] = [];
  const removed: string[] = [];

  for (const [file, content] of wanted) {
    const target = absolute(root, file);

    if ((await readText(target)) === content) continue;

    await mkdir(path.dirname(target), { recursive: true });
    await writeAtomic(target, content);
    written.push(file);
  }

  for (const file of await existingBookmaps(root)) {
    if (wanted.has(file)) continue;

    const target = absolute(root, file);

    await rm(target, { force: true });
    removed.push(file);

    if (file.endsWith(".bookmap.json")) {
      const flowsDir = path.dirname(target);
      await removeIfEmpty(flowsDir);
      await removeIfEmpty(path.dirname(flowsDir));
    } else {
      await removeIfEmpty(path.dirname(target));
    }
  }

  return { written: written.sort(), removed: removed.sort() };
}
