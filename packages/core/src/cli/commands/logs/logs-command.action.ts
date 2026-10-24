import { colors } from "@mongez/copper";
import type { CommandActionData } from "../../../commands/types";
import {
  getRequestLog,
  listRequestLogs,
  type RequestLogReadOptions,
} from "../../../http/request-log/request-log-store";
import type {
  RequestLogFilter,
  RequestLogRecord,
  RequestLogSummary,
} from "../../../http/request-log/request-log.types";
import { flushAndExit } from "../../flush-and-exit";

/** What a `warlock logs` run produced; the action prints it. */
export type LogsCommandResult = {
  exitCode: 0 | 1;
  /** The value `--json` prints. */
  json: unknown;
  /** The lines printed without `--json`. */
  lines: string[];
};

function stringOption(value: string | number | boolean | undefined): string | undefined {
  return value === undefined || typeof value === "boolean" || String(value).trim() === ""
    ? undefined
    : String(value).trim();
}

function failure(message: string): LogsCommandResult {
  return { exitCode: 1, json: { ok: false, message }, lines: [message] };
}

/** `HH:MM:SS` of an ISO time, in local time. */
function clock(time: string): string {
  const date = new Date(time);

  return Number.isNaN(date.getTime()) ? time : date.toTimeString().slice(0, 8);
}

/** The table `warlock logs requests` prints. Uncolored, so it is testable. */
export function formatRequestLogRows(rows: readonly RequestLogSummary[]): string[] {
  if (rows.length === 0) return ["No requests found."];

  return rows.map((row) => {
    const error = row.error ? `  ! ${row.error}` : "";

    return `${clock(row.time)}  ${row.status}  ${row.method.padEnd(6)} ${String(Math.round(row.durationMs)).padStart(6)}ms  ${row.url}  ${row.id}${error}`;
  });
}

/** The full text of one record. Uncolored, so it is testable. */
export function formatRequestLogRecord(record: RequestLogRecord): string[] {
  const lines = [
    `${record.method} ${record.url} -> ${record.status}  (${Math.round(record.durationMs)}ms)`,
    `  id ${record.id}  trace ${record.traceId}  at ${record.time}`,
    `  route ${record.route.name ?? "-"} ${record.route.pattern ?? ""}`.trimEnd(),
  ];

  if (record.session) lines.push(`  user ${record.session.userType ?? "-"} ${record.session.userId ?? ""}`.trimEnd());
  if (record.ip) lines.push(`  ip ${record.ip}`);

  if (record.error) {
    const where = [record.error.phase, record.error.file, record.error.site].filter(Boolean).join(" · ");

    lines.push("", `Error: ${record.error.name}: ${record.error.message}${where ? `  (${where})` : ""}`);

    if (record.error.stack) lines.push(...record.error.stack.split("\n").map((line) => `  ${line}`));
  }

  if (record.phases?.length) {
    lines.push("", "Phases");

    for (const phase of record.phases) lines.push(`  ${phase.name}  ${phase.durationMs}ms`);
  }

  if (record.queries) {
    const { count, slowest, nPlusOne } = record.queries;

    lines.push("", `Queries: ${count}${slowest ? `, slowest ${slowest.durationMs}ms  ${slowest.query}` : ""}`);

    for (const finding of nPlusOne ?? []) lines.push(`  N+1 x${finding.count}  ${finding.query}`);
  }

  if (record.logs?.length) {
    lines.push("", "Logs");

    for (const entry of record.logs) {
      lines.push(`  [${entry.level}] ${entry.module}.${entry.action}  ${entry.message}`);
    }
  }

  if (record.body !== undefined) lines.push("", `Body: ${JSON.stringify(record.body)}`);

  return lines;
}

/**
 * Run `warlock logs <action> [id]` against a request log directory. Pure of
 * process state (nothing printed, no exit), so it can be tested; the action
 * prints the result.
 */
export async function runLogsCommand(
  args: readonly string[],
  options: CommandActionData["options"],
  read: RequestLogReadOptions = {},
): Promise<LogsCommandResult> {
  const [action, id] = args;

  if (action === "requests") {
    const limitText = stringOption(options.limit);
    const limit = limitText === undefined ? undefined : Number(limitText);

    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      return failure(`Invalid --limit ${JSON.stringify(limitText)}: expected a positive number.`);
    }

    const filter: RequestLogFilter = {
      status: stringOption(options.status),
      route: stringOption(options.route),
      since: stringOption(options.since),
      limit,
    };

    try {
      const rows = await listRequestLogs(filter, read);

      return { exitCode: 0, json: rows, lines: formatRequestLogRows(rows) };
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  }

  if (action === "request") {
    if (!id) return failure("Usage: warlock logs request <id> [--json]");

    const record = await getRequestLog(id, read);

    if (!record) return failure(`No request with id "${id}" in the request log.`);

    return { exitCode: 0, json: record, lines: formatRequestLogRecord(record) };
  }

  return failure("Usage: warlock logs requests [--status 5xx] [--route name] [--since 1h] [--limit n] | warlock logs request <id>");
}

/** Action behind `warlock logs <action> [id]`. */
export async function logsCommandAction({ args, options }: CommandActionData): Promise<void> {
  const result = await runLogsCommand(args, options);

  if (options.json === true) {
    console.log(JSON.stringify(result.json, null, 2));
  } else if (result.exitCode === 0) {
    for (const line of result.lines) console.log(line);
  } else {
    for (const line of result.lines) console.error(colors.red(line));
  }

  if (result.exitCode !== 0) await flushAndExit(result.exitCode);
}
