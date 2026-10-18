import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SnapshotStore } from "../contracts/orchestrator/snapshot-store.contract";
import type { SupervisorSnapshot } from "../contracts/supervisor/supervisor-snapshot.type";

/** File extension of every snapshot file the store writes. */
const EXTENSION = ".json";

/** Options for {@link file}. */
export type FileSnapshotStoreOptions = {
  /** Directory holding one JSON file per key. Created on the first save. */
  dir: string;
  /** Mode for new directories (subject to umask). Default 0o700; existing directories are unchanged. */
  dirMode?: number;
  /** Exact mode for each saved file, including rewrites. Default 0o600. */
  fileMode?: number;
};

/**
 * File-system {@link SnapshotStore}: one JSON file per `runId` in `dir`.
 *
 * The file name is the URI-encoded `runId` plus `.json`, so a key can never
 * name a path outside `dir`. A save writes a temporary file and renames it
 * over the old one, so a crash mid-write leaves the previous snapshot
 * intact. Single-host only: two processes saving the same key race at the
 * rename (the last one wins). No schema; {@link FileSnapshotStore.schema}
 * returns an empty string.
 */
class FileSnapshotStore<TSnapshot extends { runId: string }> implements SnapshotStore<TSnapshot> {
  public constructor(
    private readonly dir: string,
    private readonly dirMode: number,
    private readonly fileMode: number,
  ) {}

  public async load(runId: string): Promise<TSnapshot | undefined> {
    let raw: string;

    try {
      raw = await readFile(this.path(runId), "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }

      throw error;
    }

    return JSON.parse(raw) as TSnapshot;
  }

  public async save(snapshot: TSnapshot): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: this.dirMode });

    const target = this.path(snapshot.runId);
    const temporary = `${target}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporary, JSON.stringify(snapshot), {
        encoding: "utf8",
        flag: "wx",
        mode: this.fileMode,
      });
      // umask can remove owner bits too; restore the requested mode before publishing.
      await chmod(temporary, this.fileMode);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  public async delete(runId: string): Promise<void> {
    await rm(this.path(runId), { force: true });
  }

  public async list(prefix?: string): Promise<string[]> {
    let names: string[];

    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }

      throw error;
    }

    return names
      .filter((name) => name.endsWith(EXTENSION))
      .map((name) => decodeKey(name.slice(0, -EXTENSION.length)))
      .filter((runId): runId is string => runId !== undefined)
      .filter((runId) => prefix === undefined || runId.startsWith(prefix))
      .sort();
  }

  public schema(): string {
    return "";
  }

  private path(runId: string): string {
    if (typeof runId !== "string" || runId.length === 0) {
      throw new Error("File snapshot store: runId must be a non-empty string.");
    }

    return join(this.dir, `${encodeURIComponent(runId)}${EXTENSION}`);
  }
}

function decodeKey(encoded: string): string | undefined {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Create a file-system {@link SnapshotStore} for local-first apps: durable
 * agent runs (`durable: { store }`), supervisor snapshots, and
 * `ai.session()` conversations.
 *
 * @example
 * const store = ai.snapshot.file({ dir: ".warlock/sessions" });
 * const chat = ai.session({ id: "user-42", store, agent });
 */
export function file<TSnapshot extends { runId: string } = SupervisorSnapshot>(
  options: FileSnapshotStoreOptions,
): SnapshotStore<TSnapshot> {
  if (!options || typeof options.dir !== "string" || options.dir.trim() === "") {
    throw new Error("File snapshot store requires a 'dir' option.");
  }

  const dirMode = options.dirMode ?? 0o700;
  const fileMode = options.fileMode ?? 0o600;

  for (const [name, mode] of Object.entries({ dirMode, fileMode })) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777 || (mode & 0o022) !== 0) {
      throw new Error(
        `File snapshot store: ${name} must be a permission mode (0o000–0o777) without group/other write.`,
      );
    }
  }

  return new FileSnapshotStore<TSnapshot>(options.dir, dirMode, fileMode);
}
