import type { MultipartFile } from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { createWriteStream, unlinkSync, type WriteStream } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** A file part held in a temporary file instead of memory. */
export type SpooledPart = {
  /** Absolute path of the temporary file. */
  path: string;
  /** Size of the file in bytes. */
  size: number;
  /** True once the app asked to keep the file past the response. */
  kept: boolean;
};

const SPOOL_KEY = "_spool";

/** Every temporary file still on disk, for the exit sweep. */
const liveFiles = new Set<string>();

let exitSweepRegistered = false;

function registerExitSweep() {
  if (exitSweepRegistered) return;

  exitSweepRegistered = true;

  process.once("exit", () => {
    for (const file of liveFiles) {
      try {
        unlinkSync(file);
      } catch {
        // already gone
      }
    }
  });
}

/** The temporary-file record of an upload part, when it was spooled. */
export function spoolOf(part: unknown): SpooledPart | undefined {
  return (part as Record<string, SpooledPart | undefined> | undefined)?.[SPOOL_KEY];
}

/** Delete a spooled file now. Safe to call more than once. */
export async function removeSpool(spool: SpooledPart): Promise<void> {
  liveFiles.delete(spool.path);

  try {
    await unlink(spool.path);
  } catch {
    // already gone
  }
}

/** Number of temporary files still on disk. @internal For specs. */
export function spooledFileCount(): number {
  return liveFiles.size;
}

/**
 * Collects the chunks of one file part and moves them to a temporary file once
 * they pass `memoryLimit` bytes, so a small part never touches the disk.
 */
export class PartSpooler {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private stream?: WriteStream;
  private filePath?: string;

  public constructor(private readonly memoryLimit: number) {}

  /** Add one chunk, moving to a temporary file when the limit is passed. */
  public async write(chunk: Buffer): Promise<void> {
    this.bytes += chunk.length;

    if (!this.stream) {
      this.chunks.push(chunk);

      if (this.bytes <= this.memoryLimit) return;

      this.filePath = path.join(tmpdir(), `warlock-upload-${randomUUID()}`);
      liveFiles.add(this.filePath);
      registerExitSweep();

      this.stream = createWriteStream(this.filePath, { mode: 0o600 });
      this.stream.on("error", () => undefined);

      const buffered = Buffer.concat(this.chunks);

      this.chunks = [];

      await this.push(buffered);

      return;
    }

    await this.push(chunk);
  }

  private push(chunk: Buffer): Promise<void> {
    const stream = this.stream!;

    return new Promise((resolve, reject) => {
      stream.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }

  /** The bytes, when the part stayed in memory. */
  public memory(): Buffer | undefined {
    return this.stream ? undefined : Buffer.concat(this.chunks);
  }

  /** Finish the temporary file and describe it. */
  public async finish(): Promise<SpooledPart | undefined> {
    const stream = this.stream;

    if (!stream || !this.filePath) return undefined;

    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.end(resolve);
    });

    return { path: this.filePath, size: this.bytes, kept: false };
  }

  /** Drop everything written so far (the request is being refused). */
  public async abort(): Promise<void> {
    this.chunks = [];

    if (!this.stream || !this.filePath) return;

    const file = this.filePath;

    this.stream.destroy();

    liveFiles.delete(file);

    await unlink(file).catch(() => undefined);
  }
}

/**
 * Attach a finished temporary file to its part: `toBuffer()` reads it back and
 * the record lets {@link UploadedFile} stream it to storage.
 */
export function attachSpool(part: MultipartFile, spool: SpooledPart): void {
  (part as unknown as Record<string, unknown>)[SPOOL_KEY] = spool;

  part.toBuffer = () => readFile(spool.path);
}
