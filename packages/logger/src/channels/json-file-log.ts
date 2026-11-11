import dayjs from "dayjs";
import fs from "fs";
import { EOL } from "os";
import type { LogContract, LogMessage, LoggingData } from "../types";
import { safeJsonStringify } from "../utils/safe-json-stringify";
import { withDirectoryRetry } from "../utils/with-directory-retry";
import { FileLog, type FileLogConfig } from "./file-log";

export type JSONFileLogConfig = FileLogConfig & {
  /**
   * How entries are stored.
   *
   * - `"json"` — one JSON document per file, `{ "messages": [...] }`. Each
   *   write reads the file, adds the new entries and writes it back.
   * - `"jsonl"` — one JSON object per line (JSON Lines) in a `.jsonl` file.
   *   Each write only appends, so its cost does not grow with the file.
   *
   * @default "json"
   */
  format?: "json" | "jsonl";
};

type JsonLogDocument = { messages: unknown[] };

export class JSONFileLog extends FileLog implements LogContract {
  /**
   * {@inheritdoc}
   */
  public name = "fileJson";

  public constructor(configurations?: JSONFileLogConfig) {
    super(configurations);
  }

  /**
   * Get file extension: `json`, or `jsonl` with `format: "jsonl"`.
   */
  public get extension(): string {
    return this.isJsonLines ? "jsonl" : "json";
  }

  /**
   * Whether entries are written as JSON Lines.
   */
  protected get isJsonLines(): boolean {
    return (this.channelConfigurations as JSONFileLogConfig).format === "jsonl";
  }

  /**
   * {@inheritdoc}
   */
  public async log(data: LoggingData) {
    let stack: string[] | undefined;

    if (data.message instanceof Error) {
      stack = data.message.stack?.split("\n");
      data.message = data.message.message;
    }

    const { module, action, message, type: level, context } = data;

    if (!this.shouldBeLogged(data)) return;

    const { date: dateFormat, time } = this.getDateAndTimeFormat();

    const date = dayjs().format(dateFormat + " " + time);

    this.messages.push({
      content: message,
      level,
      date,
      module,
      action,
      stack,
      context,
      timestamp: new Date().toISOString(),
    } as LogMessage);

    await this.checkIfMessagesShouldBeWritten(); // Immediate check on buffer size
  }

  /**
   * {@inheritdoc}
   */
  protected async writeEntries(filePath: string, messages: LogMessage[]): Promise<void> {
    if (this.isJsonLines) {
      await this.write(filePath, jsonLines(messages));
      return;
    }

    let text: string | undefined;

    try {
      text = await fs.promises.readFile(filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const document = text === undefined ? { messages: [] } : parseJsonLog(text);

    if (!document) {
      const asidePath = corruptFilePath(filePath);

      await fs.promises.rename(filePath, asidePath);
      this.reportCorruptFile(filePath, asidePath);
    }

    const contents = document ?? { messages: [] };

    contents.messages.push(...messages);

    await withDirectoryRetry(filePath, () =>
      fs.promises.writeFile(filePath, safeJsonStringify(contents, 2)),
    );
  }

  /**
   * {@inheritdoc}
   */
  protected writeEntriesSync(filePath: string, messages: LogMessage[]): void {
    if (this.isJsonLines) {
      fs.appendFileSync(filePath, jsonLines(messages));
      return;
    }

    let document: JsonLogDocument | undefined = { messages: [] };

    if (fs.existsSync(filePath)) {
      document = parseJsonLog(fs.readFileSync(filePath, "utf-8"));

      if (!document) {
        const asidePath = corruptFilePath(filePath);

        fs.renameSync(filePath, asidePath);
        this.reportCorruptFile(filePath, asidePath);
      }
    }

    const contents = document ?? { messages: [] };

    contents.messages.push(...messages);

    fs.writeFileSync(filePath, safeJsonStringify(contents, 2));
  }

  /**
   * A file that is not a valid JSON log is moved aside, never overwritten (it
   * holds earlier entries); tell the channel error handler where it went.
   */
  protected reportCorruptFile(filePath: string, asidePath: string): void {
    this.reportError(
      new Error(
        `${filePath} is not a valid JSON log; it was moved to ${asidePath} and a new file was started`,
      ),
      {
        type: "warn",
        module: "logger",
        action: "corrupt-file",
        message: `Corrupt JSON log moved aside: ${asidePath}`,
      },
    );
  }
}

/**
 * Parse a JSON log document, or `undefined` when the text is not one (a
 * truncated write, a hand edit).
 */
function parseJsonLog(text: string): JsonLogDocument | undefined {
  try {
    const parsed: unknown = JSON.parse(text);

    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as Partial<JsonLogDocument>).messages)
    ) {
      return parsed as JsonLogDocument;
    }
  } catch {
    // Not JSON.
  }

  return undefined;
}

/**
 * Where a corrupt JSON log is kept: next to it, stamped with the time.
 */
function corruptFilePath(filePath: string): string {
  return `${filePath}.corrupt-${Date.now()}`;
}

/**
 * One JSON object per line.
 */
function jsonLines(messages: LogMessage[]): string {
  return messages.map((message) => safeJsonStringify(message)).join(EOL) + EOL;
}
