import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { requestLogDirectory, REQUEST_LOG_FILE_PATTERN } from "./request-log-file-channel";
import type { RequestLogFilter, RequestLogRecord, RequestLogSummary } from "./request-log.types";

const DEFAULT_LIMIT = 50;
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/** Where to read persisted records from. */
export type RequestLogReadOptions = {
  /** @default storage/logs/requests */
  directory?: string;
};

/**
 * Parse a `--status` filter: an exact status (`404`) or a class (`5xx`).
 * Throws on anything else.
 */
export function parseRequestLogStatusFilter(value: string | number): { exact?: number; class?: number } {
  const text = String(value).trim().toLowerCase();
  const classMatch = /^([1-5])xx$/.exec(text);

  if (classMatch) return { class: Number(classMatch[1]) };

  if (/^[1-5]\d\d$/.test(text)) return { exact: Number(text) };

  throw new Error(`Invalid status filter ${JSON.stringify(value)}: use a status like 404 or a class like 5xx.`);
}

/**
 * Parse a time bound to epoch milliseconds: a number of ms since the epoch,
 * an ISO date, or (for `since`) a duration back from `now` like `30s`, `15m`,
 * `1h`, `2d`, `1w`. Throws on anything else.
 */
export function parseRequestLogTime(value: string | number, now: number = Date.now()): number {
  if (typeof value === "number") return value;

  const text = value.trim();
  const duration = /^(\d+(?:\.\d+)?)\s*([smhdw])$/i.exec(text);

  if (duration) return now - Number(duration[1]) * (UNIT_MS[duration[2]!.toLowerCase()] as number);

  if (/^\d{11,}$/.test(text)) return Number(text);

  const parsed = Date.parse(text);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid time ${JSON.stringify(value)}: use a duration like 1h, an ISO date, or epoch milliseconds.`);
  }

  return parsed;
}

/** The list row for a record. */
export function summarizeRequestLog(record: RequestLogRecord): RequestLogSummary {
  return {
    id: record.id,
    time: record.time,
    method: record.method,
    url: record.url,
    ...(record.route.pattern ? { route: record.route.pattern } : {}),
    ...(record.route.name ? { routeName: record.route.name } : {}),
    status: record.status,
    durationMs: record.durationMs,
    ...(record.error ? { error: record.error.message } : {}),
  };
}

/**
 * Compile a filter into a predicate over list rows. Bad filter values throw
 * here, once, rather than per row.
 */
export function compileRequestLogFilter(
  filter: RequestLogFilter = {},
  now: number = Date.now(),
): (row: RequestLogSummary) => boolean {
  const status = filter.status === undefined ? undefined : parseRequestLogStatusFilter(filter.status);
  const since = filter.since === undefined ? undefined : parseRequestLogTime(filter.since, now);
  const until = filter.until === undefined ? undefined : parseRequestLogTime(filter.until, now);
  const method = filter.method?.toUpperCase();
  const route = filter.route?.toLowerCase();
  const text = filter.q?.toLowerCase();

  return (row) => {
    if (status?.exact !== undefined && row.status !== status.exact) return false;

    if (status?.class !== undefined && Math.floor(row.status / 100) !== status.class) return false;

    if (method && row.method.toUpperCase() !== method) return false;

    if (route) {
      const names = [row.route, row.routeName].map((name) => name?.toLowerCase());

      if (!names.some((name) => name?.includes(route))) return false;
    }

    if (since !== undefined || until !== undefined) {
      const time = Date.parse(row.time);

      if (since !== undefined && time < since) return false;

      if (until !== undefined && time > until) return false;
    }

    if (text && !row.url.toLowerCase().includes(text) && !row.id.toLowerCase().includes(text)) {
      return false;
    }

    return true;
  };
}

/** The request log files in a directory, newest first. */
async function listFiles(directory: string): Promise<string[]> {
  let names: string[];

  try {
    names = await fs.promises.readdir(directory);
  } catch {
    return [];
  }

  const files: Array<{ file: string; day: string; modifiedAt: number }> = [];

  for (const name of names) {
    const day = REQUEST_LOG_FILE_PATTERN.exec(name)?.[1];

    if (!day) continue;

    const file = path.join(directory, name);

    try {
      files.push({ file, day, modifiedAt: (await fs.promises.stat(file)).mtimeMs });
    } catch {
      // Removed since the listing.
    }
  }

  return files
    .sort((first, second) => (second.day < first.day ? -1 : second.day > first.day ? 1 : second.modifiedAt - first.modifiedAt))
    .map(({ file }) => file);
}

async function readLines(file: string): Promise<string[]> {
  const lines: string[] = [];
  const reader = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (line.trim()) lines.push(line);
    }
  } catch {
    // A file removed or truncated while it was read: keep what was read.
  }

  return lines;
}

function parseRecord(line: string): RequestLogRecord | undefined {
  try {
    const record = JSON.parse(line) as RequestLogRecord;

    return record && record.type === "request" && typeof record.id === "string" ? record : undefined;
  } catch {
    // A half-written last line, or a line from something else.
    return undefined;
  }
}

/**
 * Persisted requests, newest first, matching the filter. Reads the daily
 * JSON-lines files of the default file channel; unreadable files and lines
 * are skipped.
 */
export async function listRequestLogs(
  filter: RequestLogFilter = {},
  options: RequestLogReadOptions = {},
): Promise<RequestLogSummary[]> {
  const matches = compileRequestLogFilter(filter);
  const limit = filter.limit !== undefined && filter.limit > 0 ? filter.limit : DEFAULT_LIMIT;
  const rows: RequestLogSummary[] = [];

  for (const file of await listFiles(options.directory ?? requestLogDirectory())) {
    const lines = await readLines(file);

    for (let index = lines.length - 1; index >= 0; index--) {
      const record = parseRecord(lines[index] as string);

      if (!record) continue;

      const row = summarizeRequestLog(record);

      if (!matches(row)) continue;

      rows.push(row);

      if (rows.length >= limit) return rows;
    }
  }

  return rows;
}

/** One persisted request by id, or `undefined`. */
export async function getRequestLog(
  id: string,
  options: RequestLogReadOptions = {},
): Promise<RequestLogRecord | undefined> {
  for (const file of await listFiles(options.directory ?? requestLogDirectory())) {
    const lines = await readLines(file);

    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index] as string;

      if (!line.includes(id)) continue;

      const record = parseRecord(line);

      if (record?.id === id) return record;
    }
  }

  return undefined;
}

const SKIPPED_CURL_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
  "traceparent",
  "x-request-id",
]);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The request as a `curl` command. Values the record redacted stay redacted
 * (`[REDACTED]`), so the command is safe to paste into a ticket; replace them
 * before running it.
 *
 * @param baseUrl Origin to use when the record has no `host` header.
 */
export function requestLogToCurl(record: RequestLogRecord, baseUrl = "http://localhost"): string {
  const headers = record.headers ?? {};
  const host = typeof headers.host === "string" ? headers.host : undefined;
  const proto = typeof headers["x-forwarded-proto"] === "string" ? headers["x-forwarded-proto"] : "http";
  const origin = host ? `${proto}://${host}` : baseUrl.replace(/\/$/, "");
  const parts = ["curl", "-X", record.method, shellQuote(`${origin}${record.url}`)];

  for (const [name, value] of Object.entries(headers)) {
    if (SKIPPED_CURL_HEADERS.has(name)) continue;

    const text = Array.isArray(value) ? value.join(", ") : String(value);

    parts.push("-H", shellQuote(`${name}: ${text}`));
  }

  if (record.body !== undefined) {
    parts.push("--data-raw", shellQuote(typeof record.body === "string" ? record.body : JSON.stringify(record.body)));
  }

  return parts.join(" ");
}
