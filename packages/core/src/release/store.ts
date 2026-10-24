import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  CommandRunner,
  ReleaseLogEntry,
  ReleaseManifest,
  ResolvedReleaseConfig,
} from "./types";

/** Everything a release operation needs; tests replace `runner` and `now`. */
export type ReleaseContext = {
  /** Project root */
  root: string;
  config: ResolvedReleaseConfig;
  runner: CommandRunner;
  now: () => Date;
  nodeVersion: string;
};

export type PointerName = "current" | "previous";

const RELEASE_ID = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/** Reject ids that could escape the releases directory. */
export function assertReleaseId(id: string): string {
  if (!RELEASE_ID.test(id) || id.includes("..")) {
    throw new Error(`"${id}" is not a valid release id.`);
  }

  return id;
}

export function baseDir(context: ReleaseContext): string {
  return path.resolve(context.root, context.config.directory);
}

export function releasesDir(context: ReleaseContext): string {
  return path.join(baseDir(context), "releases");
}

export function releaseDir(context: ReleaseContext, id: string): string {
  return path.join(releasesDir(context), assertReleaseId(id));
}

export function pointerPath(context: ReleaseContext, name: PointerName): string {
  return path.join(baseDir(context), name);
}

export function logPath(context: ReleaseContext): string {
  return path.join(baseDir(context), "release.log");
}

/** Write a file so readers see either the old content or the new, never half. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, content, "utf8");

  try {
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function readManifest(context: ReleaseContext, id: string): Promise<ReleaseManifest> {
  const file = path.join(releaseDir(context, id), "manifest.json");

  try {
    return JSON.parse(await readFile(file, "utf8")) as ReleaseManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Release "${id}" does not exist (no manifest at ${file}).`);
    }

    throw error;
  }
}

export async function writeManifest(
  context: ReleaseContext,
  manifest: ReleaseManifest,
): Promise<void> {
  await writeFileAtomic(
    path.join(releaseDir(context, manifest.id), "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/** Every release, newest first. */
export async function listManifests(context: ReleaseContext): Promise<ReleaseManifest[]> {
  let entries: string[];

  try {
    entries = await readdir(releasesDir(context));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const manifests: ReleaseManifest[] = [];

  for (const entry of entries) {
    if (!RELEASE_ID.test(entry)) continue;

    try {
      manifests.push(await readManifest(context, entry));
    } catch {
      // A directory without a readable manifest is not a release.
    }
  }

  return manifests.sort((a, b) =>
    a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt),
  );
}

/** The release id a pointer names, or `null` when it is not set. */
export async function readPointer(
  context: ReleaseContext,
  name: PointerName,
): Promise<string | null> {
  try {
    return path.basename(await readlink(pointerPath(context, name)));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT" || code === "EINVAL") return null;
    throw error;
  }
}

/**
 * Point `current` or `previous` at a release.
 *
 * The symlink is built under a temporary name and renamed over the old one,
 * so the pointer always names a complete release and is never missing. The
 * target is relative (`releases/<id>`), so the whole directory can move.
 */
export async function switchPointer(
  context: ReleaseContext,
  name: PointerName,
  id: string,
): Promise<void> {
  assertReleaseId(id);

  const pointer = pointerPath(context, name);
  const temporary = `${pointer}.${randomBytes(6).toString("hex")}.tmp`;

  await mkdir(path.dirname(pointer), { recursive: true });
  await symlink(path.join("releases", id), temporary, "dir");

  try {
    await rename(temporary, pointer);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function appendLog(
  context: ReleaseContext,
  entry: Omit<ReleaseLogEntry, "at">,
): Promise<void> {
  await mkdir(baseDir(context), { recursive: true });
  await appendFile(
    logPath(context),
    `${JSON.stringify({ at: context.now().toISOString(), ...entry })}\n`,
    "utf8",
  );
}

export async function readLog(context: ReleaseContext): Promise<ReleaseLogEntry[]> {
  try {
    const content = await readFile(logPath(context), "utf8");

    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ReleaseLogEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * The release a command works on: the id it was given, or the newest release
 * that is not active yet.
 */
export async function resolveRelease(
  context: ReleaseContext,
  id?: string,
): Promise<ReleaseManifest> {
  if (id) return readManifest(context, id);

  const manifests = await listManifests(context);
  const latest = manifests.find((manifest) =>
    ["candidate", "gated", "staged"].includes(manifest.status),
  );

  if (!latest) {
    throw new Error("No release candidate found. Create one with `warlock release candidate`.");
  }

  return latest;
}
