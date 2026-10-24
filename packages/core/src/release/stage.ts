import { randomBytes } from "node:crypto";
import { access, cp, mkdir, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendLog, readManifest, releaseDir, writeManifest, type ReleaseContext } from "./store";
import type { ReleaseManifest } from "./types";

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(directory: string): Promise<number> {
  let total = 0;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);

    if (entry.isDirectory()) total += await countFiles(location);
    else if (entry.isFile()) total += 1;
  }

  return total;
}

/**
 * Copy the built output, and what is needed to run it, into the candidate's
 * `staged` directory.
 *
 * Staged holds `dist` (or the configured output directory), `package.json`,
 * the lockfile, the configured `include` entries and a `release.json` with
 * the release identity. It is assembled under a temporary name and renamed
 * into place, so a half-copied `staged` never exists. Staging requires a
 * passing gate.
 *
 * @example
 * await stageRelease(context, "1.4.0-a1b2c3d");
 */
export async function stageRelease(context: ReleaseContext, id: string): Promise<ReleaseManifest> {
  const manifest = await readManifest(context, id);

  if (manifest.status === "active" || manifest.status === "superseded") {
    throw new Error(`Release "${id}" is ${manifest.status}; it cannot be staged again.`);
  }

  if (!manifest.gate?.passed) {
    throw new Error(`Release "${id}" has not passed the gate. Run \`warlock release gate\` first.`);
  }

  const directory = releaseDir(context, id);
  const source = path.join(directory, "source");
  const distribution = path.join(source, context.config.distDir);

  if (!(await exists(distribution))) {
    throw new Error(
      `The build output "${context.config.distDir}" is missing in the candidate. Add a build check to the gate.`,
    );
  }

  const temporary = path.join(directory, `.staged-${randomBytes(6).toString("hex")}`);
  const staged = path.join(directory, "staged");

  await mkdir(temporary, { recursive: true });

  try {
    await cp(distribution, path.join(temporary, context.config.distDir), { recursive: true });

    const entries = ["package.json", manifest.lockfile?.file, ...context.config.include];

    for (const entry of entries) {
      if (!entry) continue;

      const from = path.resolve(source, entry);

      // An include entry may not reach outside the candidate's source.
      if (from !== source && !from.startsWith(`${source}${path.sep}`)) {
        throw new Error(`release.include entry "${entry}" points outside the project.`);
      }

      if (!(await exists(from))) {
        if (entry === "package.json") throw new Error("The candidate has no package.json.");
        if (entry === manifest.lockfile?.file) continue;
        throw new Error(`release.include entry "${entry}" does not exist in the candidate.`);
      }

      const to = path.join(temporary, path.relative(source, from));

      await mkdir(path.dirname(to), { recursive: true });
      await cp(from, to, { recursive: true });
    }

    if (context.config.linkNodeModules && (await exists(path.join(source, "node_modules")))) {
      await symlink(path.join(context.root, "node_modules"), path.join(temporary, "node_modules"), "dir");
    }

    await writeFile(
      path.join(temporary, "release.json"),
      `${JSON.stringify({ id, version: manifest.version, commit: manifest.commit }, null, 2)}\n`,
      "utf8",
    );

    const files = await countFiles(temporary);

    // Re-staging replaces this candidate's own staged copy only.
    await rm(staged, { recursive: true, force: true });
    await rename(temporary, staged);

    const updated: ReleaseManifest = {
      ...manifest,
      status: "staged",
      staged: { at: context.now().toISOString(), files },
    };

    await writeManifest(context, updated);
    await appendLog(context, { event: "stage", release: id, ok: true, detail: `${files} files` });

    return updated;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    await appendLog(context, {
      event: "stage",
      release: id,
      ok: false,
      detail: (error as Error).message,
    });
    throw error;
  }
}

/** True when the staged directory holds the build output. */
export async function hasStagedArtefacts(context: ReleaseContext, id: string): Promise<boolean> {
  const staged = path.join(releaseDir(context, id), "staged");

  try {
    return (await stat(path.join(staged, context.config.distDir))).isDirectory();
  } catch {
    return false;
  }
}
