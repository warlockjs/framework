/**
 * The client build's name-to-bytes record, and the check that compares it with
 * the previous build's.
 *
 * Hashed asset names are served as immutable and old deployments keep their
 * assets for open tabs, so a name must never mean two different byte
 * sequences. Every build writes `.vite/warlock-integrity.json` into the client
 * output (file name to content digest). The next build reads the previous
 * record before it starts and refuses to finish when a file name it emits maps
 * to different bytes.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** Location of the record, relative to the client output directory. */
export const CHUNK_INTEGRITY_FILE = ".vite/warlock-integrity.json";

/** File name (relative to the client output, POSIX) to the digest of its bytes. */
export type ChunkIntegrityRecord = {
  readonly version: 1;
  readonly files: Readonly<Record<string, string>>;
};

export type ChunkIntegrityConflict = {
  readonly file: string;
  readonly previous: string;
  readonly current: string;
};

/** A file name that the previous build already used now maps to different bytes. */
export class ChunkIntegrityError extends Error {
  public readonly conflicts: readonly ChunkIntegrityConflict[];

  public constructor(conflicts: readonly ChunkIntegrityConflict[]) {
    const shown = conflicts.slice(0, 20).map((conflict) => `  - ${conflict.file}`);
    const rest = conflicts.length - shown.length;

    super(
      `The client build emitted ${conflicts.length} file(s) under a name the previous build used for different bytes:\n` +
        `${shown.join("\n")}${rest > 0 ? `\n  ... and ${rest} more` : ""}\n` +
        "Hashed asset names are served as immutable, so a name must always mean the same bytes. " +
        "Do not deploy this build next to the previous one; if the previous build is no longer served, " +
        "delete its integrity record (client/.vite/warlock-integrity.json, or the file the web build option previousBuild names) and build again.",
    );
    this.name = "ChunkIntegrityError";
    this.conflicts = conflicts;
  }
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

/** Digests every emitted file under `assets/`, skipping precompressed siblings. */
export async function recordChunkIntegrity(outDir: string): Promise<ChunkIntegrityRecord> {
  const files: Record<string, string> = {};
  const root = path.join(outDir, "assets");

  if (!existsSync(root)) return { version: 1, files };

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }

      if (!entry.isFile() || entry.name.endsWith(".br") || entry.name.endsWith(".gz")) continue;

      const relative = path.relative(outDir, absolute).split(path.sep).join("/");
      files[relative] = digestOf(await readFile(absolute));
    }
  };

  await visit(root);

  return { version: 1, files };
}

/**
 * Reads a previous record from a file, or from a build output directory (its
 * `client/` folder, or the client folder itself). A missing record is
 * `undefined`: a first build has nothing to compare with.
 */
export async function readChunkIntegrity(
  location: string,
): Promise<ChunkIntegrityRecord | undefined> {
  const candidates = [
    location,
    path.join(location, CHUNK_INTEGRITY_FILE),
    path.join(location, "client", CHUNK_INTEGRITY_FILE),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate) || !(await stat(candidate)).isFile()) continue;

    let parsed: unknown;

    try {
      parsed = JSON.parse(await readFile(candidate, "utf8"));
    } catch (error) {
      throw new Error(`The previous build's integrity record "${candidate}" is not valid JSON.`, {
        cause: error,
      });
    }

    const record = parsed as Partial<ChunkIntegrityRecord> | null;

    if (
      record === null ||
      typeof record !== "object" ||
      record.version !== 1 ||
      typeof record.files !== "object" ||
      record.files === null
    ) {
      throw new Error(
        `The previous build's integrity record "${candidate}" is not a version 1 record.`,
      );
    }

    return record as ChunkIntegrityRecord;
  }

  return undefined;
}

/** The files both records name whose bytes differ. */
export function findChunkIntegrityConflicts(
  previous: ChunkIntegrityRecord | undefined,
  current: ChunkIntegrityRecord,
): ChunkIntegrityConflict[] {
  if (previous === undefined) return [];

  const conflicts: ChunkIntegrityConflict[] = [];

  for (const [file, digest] of Object.entries(current.files)) {
    const before = previous.files[file];
    if (before !== undefined && before !== digest) {
      conflicts.push({ file, previous: before, current: digest });
    }
  }

  return conflicts;
}

/** Throws {@link ChunkIntegrityError} naming every conflicting file. */
export function assertChunkIntegrity(
  previous: ChunkIntegrityRecord | undefined,
  current: ChunkIntegrityRecord,
): void {
  const conflicts = findChunkIntegrityConflicts(previous, current);
  if (conflicts.length > 0) throw new ChunkIntegrityError(conflicts);
}

export async function writeChunkIntegrity(
  outDir: string,
  record: ChunkIntegrityRecord,
): Promise<void> {
  const file = path.join(outDir, CHUNK_INTEGRITY_FILE);

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
