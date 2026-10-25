import fs from "node:fs";
import path from "node:path";
import { FileLog, safeJsonStringify, type LoggingData } from "@warlock.js/logger";
import { storagePath } from "../../utils/paths";

/** The directory the default request log channel writes to: `storage/logs/requests`. */
export function requestLogDirectory(): string {
  return storagePath(path.join("logs", "requests"));
}

/** A request log file as the pruner sees it. */
export type RequestLogFile = {
  name: string;
  sizeBytes: number;
  modifiedAt: number;
};

/** The names of request log files: `YYYY-MM-DD.jsonl`, plus size-rotated `YYYY-MM-DD-…-<epoch>.jsonl`. */
export const REQUEST_LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:-.+)?\.jsonl$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which request log files to delete: files whose day is older than `maxDays`,
 * then the oldest files while the rest exceed `maxSizeMb`. The file being
 * written is never deleted.
 *
 * @param now Epoch milliseconds, injectable for tests.
 */
export function selectRequestLogFilesToPrune(
  files: readonly RequestLogFile[],
  policy: { maxDays: number; maxSizeMb: number },
  activeName: string,
  now: number = Date.now(),
): string[] {
  const doomed = new Set<string>();
  const dated = files
    .map((file) => ({ file, day: REQUEST_LOG_FILE_PATTERN.exec(file.name)?.[1] }))
    .filter((entry): entry is { file: RequestLogFile; day: string } => entry.day !== undefined);
  // A file is kept through the whole day `maxDays` back.
  const oldestDay = new Date(now - policy.maxDays * DAY_MS).toISOString().slice(0, 10);

  for (const { file, day } of dated) {
    if (file.name !== activeName && day < oldestDay) doomed.add(file.name);
  }

  const limit = policy.maxSizeMb * 1024 * 1024;
  const remaining = dated
    .filter(({ file }) => !doomed.has(file.name))
    .sort(
      (first, second) =>
        first.file.modifiedAt - second.file.modifiedAt ||
        (first.file.name < second.file.name ? -1 : 1),
    );
  let total = remaining.reduce((sum, { file }) => sum + file.sizeBytes, 0);

  for (const { file } of remaining) {
    if (total <= limit) break;

    if (file.name === activeName) continue;

    doomed.add(file.name);
    total -= file.sizeBytes;
  }

  return [...doomed];
}

export type RequestLogFileChannelOptions = {
  /** @default storage/logs/requests */
  storagePath?: string;
  retention: { maxDays: number; maxSizeMb: number };
  /** Records buffered before a write. @default 20 */
  maxMessagesToWrite?: number;
  /** Largest file before a size rotation, in bytes. */
  maxFileSize?: number;
};

/**
 * The default request log channel: a {@link FileLog} writing one JSON record
 * per line to a daily file, `storage/logs/requests/YYYY-MM-DD.jsonl`.
 *
 * Writes are buffered by `FileLog` (flushed every few records or seconds, and
 * on exit). Old files are pruned on boot and whenever a new day's file starts,
 * by age (`maxDays`) and total size (`maxSizeMb`).
 */
export class RequestLogFileChannel extends FileLog {
  public override name = "requestLog";

  private readonly policy: { maxDays: number; maxSizeMb: number };

  public constructor(options: RequestLogFileChannelOptions) {
    super({
      storagePath: options.storagePath ?? requestLogDirectory(),
      name: "requests",
      chunk: "daily",
      extension: "jsonl",
      maxMessagesToWrite: options.maxMessagesToWrite ?? 20,
      ...(options.maxFileSize === undefined ? {} : { maxFileSize: options.maxFileSize }),
    });

    this.policy = options.retention;
  }

  /**
   * Buffer one record: `data.context` is the {@link RequestLogRecord}, written
   * as one JSON line.
   */
  public override async log(data: LoggingData): Promise<void> {
    if (!data.context) return;

    this.messages.push({
      content: safeJsonStringify(data.context),
      level: data.type,
      date: "",
      module: data.module,
      action: data.action,
      timestamp: new Date().toISOString(),
    });

    await this.checkIfMessagesShouldBeWritten();
  }

  /**
   * {@inheritdoc}
   */
  protected override async pruneFiles(): Promise<void> {
    try {
      const directory = this.storagePath;
      const names = await fs.promises.readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as string[];

        throw error;
      });
      const files: RequestLogFile[] = [];

      for (const name of names) {
        if (!REQUEST_LOG_FILE_PATTERN.test(name)) continue;

        try {
          const stats = await fs.promises.stat(path.join(directory, name));

          if (stats.isFile()) {
            files.push({ name, sizeBytes: stats.size, modifiedAt: stats.mtimeMs });
          }
        } catch {
          // A file removed between readdir and stat is already gone.
        }
      }

      const doomed = selectRequestLogFilesToPrune(
        files,
        this.policy,
        `${this.fileName}.${this.extension}`,
      );

      for (const name of doomed) {
        await fs.promises
          .unlink(path.join(directory, name))
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
      }
    } catch (error) {
      this.reportRetentionError(error, this.storagePath);
    }
  }
}
