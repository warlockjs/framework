import { ensureDirectoryAsync } from "@warlock.js/fs";
import dayjs from "dayjs";
import fs from "fs";
import { EOL } from "os";
import path from "path";
import { LogChannel } from "../log-channel";
import type {
  BasicLogConfigurations,
  LogContract,
  LoggingData,
  LogLevel,
  LogMessage,
} from "../types";
import {
  escapeRegExp,
  fileNamePatternSource,
  renderFileName,
  type FileNameOption,
} from "./file-name-pattern";

export type { FileNameOption } from "./file-name-pattern";

/** Default file name of a `daily` chunk: sortable ISO date. */
export const DAILY_FILE_NAME = "{YYYY}-{MM}-{DD}";

/** Default file name of an `hourly` chunk: sortable ISO date and hour. */
export const HOURLY_FILE_NAME = "{YYYY}-{MM}-{DD}-{HH}";

/** Default date part of a size-rotated file's name. */
export const ROTATE_FILE_NAME = "{YYYY}-{MM}-{DD}";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which old log files `FileLog` removes, on boot and whenever it starts a new
 * file (a size rotation or a dated name rolling over). Only files in the log
 * directory (each group directory with `groupBy`) whose names match the
 * channel's file name pattern are considered; the file being written is
 * always kept.
 */
export type FileLogRetention = {
  /**
   * Keep at most this many matching files per directory, newest (by
   * modification time) first, counting the file being written.
   */
  maxFiles?: number;
  /**
   * Remove matching files last modified more than this many days ago.
   */
  maxAgeDays?: number;
  /**
   * Which file names (with extension) belong to this channel. Defaults to one
   * derived from `fileName` and `rotateFileName`; required when `fileName` is
   * a function.
   */
  match?: RegExp;
};

export type FileLogConfig = BasicLogConfigurations & {
  storagePath?: string;
  /**
   * Base name, without extension: the file name of a `single` chunk and the
   * `{name}` token of a `fileName` pattern.
   *
   * @default app
   */
  name?: string;
  /**
   * The file name, without extension: a pattern such as
   * `"app-{YYYY}-{MM}-{DD}"` (tokens `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}`
   * `{name}`, local time) or a function of the current date. Evaluated at
   * every write, so a dated name starts a new file when it changes.
   *
   * @default by chunk: `single` → name, `daily` → `{YYYY}-{MM}-{DD}`, `hourly` → `{YYYY}-{MM}-{DD}-{HH}`
   */
  fileName?: FileNameOption;
  /**
   * chunk mode: picks the default `fileName`.
   * `single` writes one file named `name`, `daily` one file per day
   * (`YYYY-MM-DD`), `hourly` one per hour (`YYYY-MM-DD-HH`). Size rotation
   * applies to each.
   * @default single
   */
  chunk?: "single" | "daily" | "hourly";
  /**
   * Whether to rotate the file
   *
   * @default true
   */
  rotate?: boolean;
  /**
   * File Extension
   *
   * @default log
   */
  extension?: string;
  /**
   * Middle part of a size-rotated file's name:
   * `<file name>-<rotateFileName>-<epoch ms>.<extension>`. Same forms as
   * `fileName` (a token pattern or a function of the rotation date); text
   * without tokens is used as is.
   *
   * @default {YYYY}-{MM}-{DD}
   */
  rotateFileName?: FileNameOption;
  /**
   * Max file size before rotating the file
   *
   * @default 10MB
   */
  maxFileSize?: number;
  /**
   * Remove old log files on boot and whenever a new file is started.
   *
   * @default none (nothing is removed)
   */
  retention?: FileLogRetention;
  /**
   * Set the max messages that needs to be added before writing to the file
   *
   * @default 100
   */
  maxMessagesToWrite?: number;
  /**
   * Group logs by
   * Please note that the order matters here
   * For example, if you set `groupBy: ['level', 'module']`, the logs will be added in level name first, then by module
   *
   * @default none
   */
  groupBy?: ("level" | "module" | "action")[];
  /**
   * Define what levels should be logged
   *
   * @default all
   */
  levels?: LogLevel[];
  /**
   * Date and time format
   */
  dateFormat?: {
    date?: string;
    time?: string;
  };
};

export class FileLog extends LogChannel<FileLogConfig> implements LogContract {
  /**
   * {@inheritdoc}
   */
  public name = "file";

  /**
   * Messages buffer
   */
  protected messages: LogMessage[] = [];

  /**
   * Grouped messages
   */
  protected groupedMessages: Record<string, LogMessage[]> = {};

  /**
   * Default channel configurations
   */
  protected defaultConfigurations: FileLogConfig = {
    storagePath: process.cwd() + "/storage/logs",
    rotate: true,
    name: "app",
    extension: "log",
    chunk: "single",
    maxMessagesToWrite: 100,
    filter: () => true,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    rotateFileName: ROTATE_FILE_NAME,
    dateFormat: {
      date: "DD-MM-YYYY",
      time: "HH:mm:ss",
    },
  };

  /**
   * Last write time
   */
  protected lastWriteTime = Date.now();

  /**
   * A flag to determine if the file is being written
   */
  protected isWriting = false;

  /**
   * Handle for the periodic flush interval. Stored so it can be cleared
   * in `dispose()` — long-lived processes that create channels dynamically
   * would otherwise leak one timer per channel.
   */
  protected flushIntervalHandle?: NodeJS.Timeout;

  /**
   * Set when a size rotation started a new file, so the next write prunes.
   */
  protected retentionDue = false;

  /**
   * File name of the last write, to notice a dated name rolling over.
   */
  protected lastFileName?: string;

  /**
   * The running (or last) prune, so prunes never overlap.
   */
  protected pruning?: Promise<void>;

  /**
   * Whether the "function `fileName` needs `retention.match`" error was
   * already reported.
   */
  protected missingMatchReported = false;

  /**
   * {@inheritdoc}
   */
  protected setConfigurations(configurations: FileLogConfig) {
    assertRetention(configurations.retention);

    return super.setConfigurations(configurations);
  }

  /**
   * Check file size for file rotation
   */
  protected async checkAndRotateFile(filePath = this.filePath) {
    if (!this.config("rotate")) return;

    try {
      const stats = await fs.promises.stat(filePath);
      if (stats.size >= this.config("maxFileSize")!) {
        await this.rotateLogFile(filePath);
      }
    } catch (error: any) {
      // ENOENT is expected when the file hasn't been created yet — there is
      // nothing to rotate, so stay silent. Surface anything else.
      if (error.code !== "ENOENT") {
        console.error("Error checking log file:", error);
      }
    }
  }

  /**
   * Rotate the given log file (the active one by default) aside as
   * `<file name>-<rotateFileName>-<epoch ms>.<extension>` in its directory.
   */
  protected async rotateLogFile(filePath = this.filePath) {
    const now = new Date();
    const extension = this.extension;
    const baseName = path.basename(filePath, `.${extension}`);
    const rotateName = renderFileName(
      this.config("rotateFileName") ?? ROTATE_FILE_NAME,
      now,
      this.baseName,
    );

    const rotatedFilePath = path.join(
      path.dirname(filePath),
      `${baseName}-${rotateName}-${now.getTime()}.${extension}`,
    );

    await fs.promises.rename(filePath, rotatedFilePath).then(
      () => {
        this.retentionDue = true;
      },
      (error) => {
        console.error("Error rotating file:", error);
      },
    );
  }

  /**
   * Flush messages
   *
   * Starts a periodic re-check so low-traffic channels don't sit on buffered
   * entries indefinitely. The handle is stored on the instance so `dispose()`
   * can stop it — without this, every channel leaks a timer for the lifetime
   * of the process.
   */
  protected initMessageFlush() {
    this.flushIntervalHandle = setInterval(() => {
      if (
        this.messages.length > 0 &&
        (this.messages.length >= this.maxMessagesToWrite || Date.now() - this.lastWriteTime > 5000)
      ) {
        this.writeMessagesToFile();
      }
    }, 5000);

    // A periodic re-check must never be the reason a process stays alive: a
    // finished test run or CLI command would otherwise wait for it forever.
    // Buffered entries are still written by `flush()` / `flushSync()` on shutdown.
    this.flushIntervalHandle.unref?.();
  }

  /**
   * Stop the background flush interval and drain any buffered entries.
   *
   * Call this when discarding a channel (e.g. reconfiguring the logger at
   * runtime) so the 5-second timer doesn't keep the event loop alive. Safe to
   * call more than once.
   */
  public dispose(): void {
    if (this.flushIntervalHandle) {
      clearInterval(this.flushIntervalHandle);
      this.flushIntervalHandle = undefined;
    }

    this.flushSync();
  }

  /**
   * Get file path
   */
  public get filePath() {
    const fileName = this.fileName;

    const extension = this.extension;

    return path.join(this.storagePath, `${fileName}.${extension}`);
  }

  /**
   * Get max messages
   */
  protected get maxMessagesToWrite(): number {
    return this.config("maxMessagesToWrite")!;
  }

  /**
   * The configured `name` option.
   */
  protected get baseName(): string {
    return this.config("name") ?? "app";
  }

  /**
   * The `fileName` option, or the chunk's default. `undefined` means the
   * plain `name` of a `single` chunk, used as is (braces included).
   */
  protected get fileNamePattern(): FileNameOption | undefined {
    const configured = this.config("fileName");

    if (configured !== undefined) return configured;

    switch (this.config("chunk")) {
      case "daily":
        return DAILY_FILE_NAME;
      case "hourly":
        return HOURLY_FILE_NAME;
      case "single":
      default:
        return undefined;
    }
  }

  /**
   * Current file name, without extension
   */
  public get fileName(): string {
    const pattern = this.fileNamePattern;

    return pattern === undefined
      ? this.baseName
      : renderFileName(pattern, new Date(), this.baseName);
  }

  /**
   * Get file extension
   */
  public get extension(): string {
    return this.config("extension")!;
  }

  /**
   * Get content
   */
  protected get content() {
    return this.messages.map((message) => message.content).join(EOL) + EOL;
  }

  /**
   * Get storage path
   */
  public get storagePath(): string {
    return this.config("storagePath")!;
  }

  /**
   * {@inheritdoc}
   */
  protected async init() {
    const logsDirectory = this.storagePath;

    await ensureDirectoryAsync(logsDirectory);

    this.initMessageFlush();

    await this.prune();
  }

  /**
   * Remove old log files as configured by `retention`. Runs on boot and
   * whenever a new file is started; call it yourself to prune on demand.
   * Never rejects: failures go to the channel error handler.
   */
  public prune(): Promise<void> {
    const run = (this.pruning ?? Promise.resolve()).then(() => this.pruneFiles());

    this.pruning = run;

    return run;
  }

  /**
   * Prune once a write started a new file: after a size rotation, or when a
   * dated file name rolled over. Never throws.
   */
  protected async afterWrite(): Promise<void> {
    let fileName: string;

    try {
      fileName = this.fileName;
    } catch {
      return;
    }

    const rolledOver = this.lastFileName !== undefined && this.lastFileName !== fileName;

    this.lastFileName = fileName;

    if (!rolledOver && !this.retentionDue) return;

    this.retentionDue = false;

    await this.prune();
  }

  /**
   * Apply `retention` to every directory this channel writes to.
   */
  protected async pruneFiles(): Promise<void> {
    const retention = this.config("retention");

    if (!retention || (retention.maxFiles === undefined && retention.maxAgeDays === undefined)) {
      return;
    }

    try {
      const matcher = this.retentionMatcher(retention);

      if (!matcher) return;

      const activeFile = `${this.fileName}.${this.extension}`;

      for (const directory of await this.retentionDirectories()) {
        await this.pruneDirectory(directory, matcher, retention, activeFile);
      }
    } catch (error) {
      this.reportRetentionError(error, this.storagePath);
    }
  }

  /**
   * The expression a file name must match to be pruned, or `undefined` when
   * none can be derived (a function `fileName` without `retention.match`).
   */
  protected retentionMatcher(retention: FileLogRetention): RegExp | undefined {
    if (retention.match) {
      // Drop `g`/`y`: their `lastIndex` would make `test()` stateful.
      return new RegExp(retention.match.source, retention.match.flags.replace(/[gy]/g, ""));
    }

    const pattern = this.fileNamePattern;

    if (typeof pattern === "function") {
      if (!this.missingMatchReported) {
        this.missingMatchReported = true;
        this.reportRetentionError(
          new Error(
            "FileLog retention needs `retention.match` when `fileName` is a function; no files were pruned",
          ),
          this.storagePath,
        );
      }

      return undefined;
    }

    const name = this.baseName;
    const fileSource =
      pattern === undefined ? escapeRegExp(name) : fileNamePatternSource(pattern, name);
    const rotateName = this.config("rotateFileName") ?? ROTATE_FILE_NAME;
    const rotateSource =
      typeof rotateName === "function" ? ".+" : fileNamePatternSource(rotateName, name);

    return new RegExp(
      `^${fileSource}(?:-${rotateSource}-\\d{13,})?\\.${escapeRegExp(this.extension)}$`,
    );
  }

  /**
   * The log directory, or each group directory when `groupBy` is set.
   */
  protected async retentionDirectories(): Promise<string[]> {
    let directories = [this.storagePath];
    const depth = this.config("groupBy")?.length ?? 0;

    for (let level = 0; level < depth; level++) {
      const next: string[] = [];

      for (const directory of directories) {
        const entries = await fs.promises
          .readdir(directory, { withFileTypes: true })
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") this.reportRetentionError(error, directory);
            return [];
          });

        for (const entry of entries) {
          if (entry.isDirectory()) next.push(path.join(directory, entry.name));
        }
      }

      directories = next;
    }

    return directories;
  }

  /**
   * Remove the matching files of one directory that `retention` no longer
   * keeps. Each failure is reported and the rest still run.
   */
  protected async pruneDirectory(
    directory: string,
    matcher: RegExp,
    retention: FileLogRetention,
    activeFile: string,
  ): Promise<void> {
    let names: string[];

    try {
      names = await fs.promises.readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.reportRetentionError(error, directory);
      }
      return;
    }

    const candidates: Array<{ filePath: string; name: string; modifiedAt: number }> = [];

    for (const name of names) {
      if (name === activeFile || !matcher.test(name)) continue;

      const filePath = path.join(directory, name);

      try {
        const stats = await fs.promises.stat(filePath);

        if (stats.isFile()) candidates.push({ filePath, name, modifiedAt: stats.mtimeMs });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.reportRetentionError(error, filePath);
        }
      }
    }

    // Newest first; the name breaks ties so the order is stable.
    candidates.sort((a, b) => b.modifiedAt - a.modifiedAt || (a.name < b.name ? 1 : -1));

    // The file being written counts toward `maxFiles` and is never removed.
    const keep =
      retention.maxFiles === undefined
        ? Infinity
        : retention.maxFiles - (names.includes(activeFile) ? 1 : 0);
    const oldestKept =
      retention.maxAgeDays === undefined ? -Infinity : Date.now() - retention.maxAgeDays * DAY_MS;

    for (const [index, candidate] of candidates.entries()) {
      if (index < keep && candidate.modifiedAt >= oldestKept) continue;

      try {
        await fs.promises.unlink(candidate.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.reportRetentionError(error, candidate.filePath);
        }
      }
    }
  }

  /**
   * Send a retention failure to the channel error handler.
   */
  protected reportRetentionError(error: unknown, target: string): void {
    this.reportError(error, {
      type: "error",
      module: "logger",
      action: "retention",
      message: `Log retention failed for ${target}`,
    });
  }

  /**
   * Synchronously flush messages
   */
  public flushSync(): void {
    if (this.messages.length === 0 && Object.keys(this.groupedMessages).length === 0) return;

    if (this.messagedShouldBeGrouped) {
      this.prepareGroupedMessages();
      // `Object.entries` rather than `for...in` + index: under
      // `noUncheckedIndexedAccess` an index read is `LogMessage[] | undefined`
      // even when the key came from the object itself, and entries hands over
      // the value already narrowed. Same iteration, no assertion.
      for (const [key, groupMessages] of Object.entries(this.groupedMessages)) {
        const directoryPath = path.join(this.storagePath, key);
        fs.mkdirSync(directoryPath, { recursive: true });
        const filePath = path.join(directoryPath, `${this.fileName}.${this.extension}`);
        const content = groupMessages.map((message) => message.content).join(EOL) + EOL;
        fs.appendFileSync(filePath, content);
      }
    } else {
      fs.mkdirSync(this.storagePath, { recursive: true });
      fs.appendFileSync(this.filePath, this.content);
    }

    this.onSave();
  }

  /**
   * Asynchronously drain buffered entries to disk.
   *
   * The async analogue of {@link flushSync}: it reuses the same async writer
   * as the background interval, so a caller on a graceful-shutdown path can
   * `await channel.flush()` (or `await log.flush()`) and rely on the buffer
   * being on disk once it resolves. `JSONFileLog` inherits this unchanged —
   * its overridden `writeMessagesToFile` performs the JSON merge.
   */
  public async flush(): Promise<void> {
    if (this.messages.length === 0 && Object.keys(this.groupedMessages).length === 0) {
      return;
    }

    // Clear the in-flight lock so a deliberate drain is never short-circuited
    // by a half-finished background write, then await the async writer to
    // completion — unlike the fire-and-forget interval, callers depend on the
    // buffer reaching disk before this resolves.
    this.isWriting = false;

    await this.writeMessagesToFile();
  }

  /**
   * {@inheritdoc}
   */
  public async log(data: LoggingData) {
    const { module, action, message, type: level, context } = data;

    if (!this.shouldBeLogged(data)) return;

    const { date: dateFormat, time } = this.getDateAndTimeFormat();

    const date = dayjs().format(dateFormat + " " + time);

    let content = `[${date}] [${level}] [${module}][${action}]: `;

    let stack: string | undefined;

    // check if message is an instance of Error
    if (message instanceof Error) {
      // in that case we need to store the error message and stack trace
      content += message.message + EOL;
      content += `[trace]` + EOL;
      content += message.stack;
      stack = message.stack;
    } else {
      content += message;
    }

    this.messages.push({
      content,
      level,
      date,
      module,
      action,
      stack,
      context,
      timestamp: new Date().toISOString(),
    });

    await this.checkIfMessagesShouldBeWritten(); // Immediate check on buffer size
  }

  /**
   * Check if messages should be written
   */
  protected async checkIfMessagesShouldBeWritten() {
    if (this.messages.length >= this.maxMessagesToWrite || Date.now() - this.lastWriteTime > 5000) {
      await this.writeMessagesToFile();
    }
  }

  /**
   * Should be called after messages are saved
   */
  protected onSave() {
    this.messages = [];
    this.groupedMessages = {};
    this.isWriting = false;
    this.lastWriteTime = Date.now();
  }

  /**
   * Check if messages should be grouped
   */
  protected get messagedShouldBeGrouped(): boolean {
    return Number(this.config("groupBy")?.length) > 0;
  }

  /**
   * Write messages to the file
   */
  protected async writeMessagesToFile() {
    if (this.messages.length === 0 || this.isWriting || !this.isInitialized) return;

    this.isWriting = true;

    if (this.messagedShouldBeGrouped) {
      return await this.writeGroupedMessagesToFile();
    }

    try {
      const filePath = this.filePath;

      await this.checkAndRotateFile(filePath); // Ensure we check file size before writing
      await this.write(filePath, this.content);
      this.onSave();
    } catch (error) {
      console.error("Failed to write log:", error);
      // Implement fallback logic here
      this.isWriting = false;
      return;
    }

    await this.afterWrite();
  }

  /**
   * Write grouped messages to the file
   */
  protected async writeGroupedMessagesToFile(): Promise<void> {
    // first step, is to group the messages
    this.prepareGroupedMessages();

    // now each key in the grouped messages, represents the directory path that should extend the storage path
    for (const [key, groupMessages] of Object.entries(this.groupedMessages)) {
      const directoryPath = path.join(this.storagePath, key);

      try {
        await ensureDirectoryAsync(directoryPath);

        const filePath = path.join(directoryPath, `${this.fileName}.${this.extension}`);

        await this.checkAndRotateFile(filePath); // Ensure we check file size before writing

        const content = groupMessages.map((message) => message.content).join(EOL) + EOL;

        await this.write(filePath, content);
      } catch (error) {
        console.error("Failed to write log:", error);
      }
    }

    this.onSave();
    this.isWriting = false;

    await this.afterWrite();
  }

  /**
   * Prepare grouped messages
   */
  protected prepareGroupedMessages(): void {
    this.messages.forEach((message) => {
      const key = this.config("groupBy")!
        .map((groupKey) => encodeURIComponent(message[groupKey]))
        .join("/");

      this.groupedMessages[key] = this.groupedMessages[key] || [];
      this.groupedMessages[key].push(message);
    });
  }

  /**
   * Start writing to the file
   */
  protected async write(filePath: string, content: string) {
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath, { flags: "a" });

      writer.write(content, (error) => {
        writer.end();
        if (error) {
          reject(error);
        } else {
          resolve(true);
        }
      });
    });
  }
}

/**
 * Reject a `retention` that could never keep or remove anything sensibly.
 */
function assertRetention(retention: FileLogRetention | undefined): void {
  if (!retention) return;

  const { maxFiles, maxAgeDays, match } = retention;

  if (maxFiles !== undefined && (!Number.isInteger(maxFiles) || maxFiles < 1)) {
    throw new TypeError("FileLog retention.maxFiles must be a positive integer");
  }

  if (maxAgeDays !== undefined && (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0)) {
    throw new TypeError("FileLog retention.maxAgeDays must be a positive number");
  }

  if (match !== undefined && !(match instanceof RegExp)) {
    throw new TypeError("FileLog retention.match must be a RegExp");
  }
}
