import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { appendLog, releaseDir, releasesDir, writeManifest, type ReleaseContext } from "./store";
import type { ReleaseManifest } from "./types";

const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"];

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type CandidateOptions = {
  /** Commit to freeze. Defaults to `HEAD`. */
  commit?: string;
  /** Freeze even when the working tree has uncommitted changes. */
  allowDirty?: boolean;
};

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function git(context: ReleaseContext, command: string): Promise<string> {
  const result = await context.runner(`git ${command}`, { cwd: context.root });

  if (result.code !== 0) {
    throw new Error(`git ${command} failed: ${result.output.trim() || `exit ${result.code}`}`);
  }

  return result.output.trim();
}

/**
 * Freeze a commit into a candidate directory.
 *
 * The commit is exported with `git archive` into `<release>/source`, so every
 * later step (gate, build, stage) works on exactly those bytes and not on a
 * working tree that keeps changing. A dirty tree is refused unless
 * `allowDirty` is set, because the candidate would not describe what is
 * checked out.
 *
 * @example
 * const manifest = await createCandidate(context, {});
 */
export async function createCandidate(
  context: ReleaseContext,
  options: CandidateOptions = {},
): Promise<ReleaseManifest> {
  if (!options.allowDirty) {
    const exclude = shellQuote(`:(exclude)${context.config.directory}`);
    const dirty = await git(context, `status --porcelain -- . ${exclude}`);

    if (dirty) {
      throw new Error(
        `The working tree has uncommitted changes:\n${dirty}\nCommit or stash them, or pass --allow-dirty.`,
      );
    }
  }

  const commit = await git(
    context,
    `rev-parse --verify ${shellQuote(`${options.commit ?? "HEAD"}^{commit}`)}`,
  );
  const packageText = await git(context, `show ${shellQuote(`${commit}:package.json`)}`);
  const version = (JSON.parse(packageText) as { version?: string }).version;

  if (!version) throw new Error("package.json has no `version`; a release needs one.");

  const id = `${version}-${commit.slice(0, 7)}`;
  const directory = releaseDir(context, id);

  if (await exists(directory)) {
    throw new Error(`Release "${id}" already exists. Releases are never overwritten.`);
  }

  const source = path.join(directory, "source");

  await mkdir(releasesDir(context), { recursive: true });
  await mkdir(source, { recursive: true });

  try {
    // Two steps rather than a pipe: a failing `git archive` must not be
    // masked by the exit code of `tar`.
    const archive = path.join(directory, "source.tar");

    await git(context, `archive --format=tar -o ${shellQuote(archive)} ${shellQuote(commit)}`);

    const extracted = await context.runner(
      `tar -xf ${shellQuote(archive)} -C ${shellQuote(source)}`,
      { cwd: context.root },
    );

    await rm(archive, { force: true });

    if (extracted.code !== 0) {
      throw new Error(`Could not extract the commit archive: ${extracted.output.trim()}`);
    }

    if (context.config.linkNodeModules) {
      const modules = path.join(context.root, "node_modules");

      if (await exists(modules)) await symlink(modules, path.join(source, "node_modules"), "junction");
    }

    let lockfile: ReleaseManifest["lockfile"] = null;

    for (const file of LOCKFILES) {
      const location = path.join(source, file);

      if (await exists(location)) {
        lockfile = {
          file,
          sha256: createHash("sha256")
            .update(await readFile(location))
            .digest("hex"),
        };
        break;
      }
    }

    const manifest: ReleaseManifest = {
      schema: 1,
      id,
      version,
      commit,
      createdAt: context.now().toISOString(),
      nodeVersion: context.nodeVersion,
      lockfile,
      status: "candidate",
    };

    await writeManifest(context, manifest);
    await appendLog(context, { event: "candidate", release: id, ok: true, detail: commit });

    return manifest;
  } catch (error) {
    // The directory was created by this call and holds no finished release.
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
