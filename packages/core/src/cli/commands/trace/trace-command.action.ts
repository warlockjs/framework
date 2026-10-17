import { readFileSync } from "node:fs";
import path from "node:path";
import { colors } from "@mongez/copper";
import type { CommandActionData } from "../../../commands/types";
import { ERROR_CODES, errorCodeOf } from "../../../errors/error-codes";
import type { TraceReport } from "../../../tooling/trace/trace-report.types";
import { traceRequest } from "../../../tooling/trace/trace-request";
import { flushAndExit } from "../../flush-and-exit";

function stringOption(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Every `--header` / `-H` value in `argv`, in order. The CLI parser keeps only
 * the last value of a repeated option, so headers are read from argv directly.
 * Accepts `--header k:v`, `--header=k:v`, `-H k:v` and `-H=k:v`.
 */
export function collectHeaderValues(argv: readonly string[]): string[] {
  const values: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    if (token === undefined) continue;

    const inline = /^(?:--header|-H)=(.*)$/s.exec(token);

    if (inline) {
      values.push(inline[1] ?? "");
      continue;
    }

    if (token === "--header" || token === "-H") {
      const next = argv[index + 1];

      if (next !== undefined) {
        values.push(next);
        index++;
      }
    }
  }

  return values;
}

/**
 * Turn `name:value` strings into a header object. The first colon splits; both
 * sides are trimmed. Throws on a value without a colon or with an empty name.
 */
export function parseHeaderValues(values: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const value of values) {
    const colon = value.indexOf(":");
    const name = colon === -1 ? "" : value.slice(0, colon).trim();

    if (name.length === 0) {
      throw new Error(`Invalid --header ${JSON.stringify(value)}: expected name:value.`);
    }

    headers[name] = value.slice(colon + 1).trim();
  }

  return headers;
}

/**
 * The request body for `--body`: `@path` reads the file (relative to `cwd`);
 * text that parses as JSON becomes that value (sent as JSON); anything else is
 * sent as the text itself. `undefined` without `--body`.
 */
export function parseTraceBody(
  value: string | undefined,
  cwd = process.cwd(),
  readFile: (file: string) => string = (file) => readFileSync(file, "utf8"),
): unknown {
  if (value === undefined) return undefined;

  const text = value.startsWith("@") ? readFile(path.resolve(cwd, value.slice(1))) : value;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function ms(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)}ms`;
}

/** The human summary `warlock trace` prints without `--json`. Uncolored, so it is testable. */
export function formatTraceSummary(report: TraceReport): string[] {
  const { timeline } = report;
  const lines = [
    `${report.request.method} ${report.request.url} → ${report.response.status}  (${report.route ?? "no route"}, id ${report.requestId})`,
    `  total ${ms(report.timings.totalMs)} server, ${ms(report.timings.clientMs)} round trip`,
  ];

  if (timeline.routeMatch) lines.push(`  route.match  ${ms(timeline.routeMatch.durationMs)}`);

  for (const middleware of timeline.middleware) {
    lines.push(`  middleware   ${middleware.name ?? "(anonymous)"}  ${ms(middleware.durationMs)}`);
  }

  if (timeline.validation.ran) {
    const verdict = timeline.validation.passed ? "passed" : "failed";

    lines.push(`  validation   ${verdict}  ${ms(timeline.validation.durationMs)}`);
  }

  if (timeline.handler) lines.push(`  handler      ${ms(timeline.handler.durationMs)}`);

  const nPlusOne = report.queries.filter((query) => query.nPlusOne).length;

  lines.push(
    `  queries ${report.queries.length}${nPlusOne > 0 ? ` (${nPlusOne} N+1)` : ""} · logs ${report.logs.length} · cache ${report.cache.length} · mails ${report.mails.length}`,
  );

  for (const warning of report.warnings) {
    if (typeof warning.message === "string") lines.push(`  ! ${warning.message}`);
  }

  if (report.error) lines.push(`  error: ${report.error}`);

  lines.push("", "Run with --json for the full timeline.");

  return lines;
}

/** The exit code for a failed trace: 2 for this machine (WL8xxx), 1 otherwise. */
export function traceFailureExitCode(error: unknown): 1 | 2 {
  const code = errorCodeOf(error);

  return code !== undefined && ERROR_CODES[code].category === "environment" ? 2 : 1;
}

/**
 * Action behind `warlock trace <method> <url>`.
 *
 * Sends the request to the running dev server and prints its devtools
 * timeline; with `--json`, stdout carries exactly the report. A failure
 * (no dev server, no devtools, no record) prints the coded error — as
 * `{ ok: false, code, message }` with `--json` — and exits 2 for this machine
 * or 1 otherwise.
 *
 * @param data Parsed CLI args: `[method, url]`, `body`, `url`, `devtoolsPath`, `idHeader`, `timeout`, `json`.
 */
export async function traceCommandAction({ args, options }: CommandActionData): Promise<void> {
  const json = options.json === true;
  const [method, url] = args;

  try {
    if (!method || !url) {
      throw new Error("Usage: warlock trace <method> <url> [--body json|@file] [--header k:v]");
    }

    const timeout = stringOption(options.timeout);
    const timeoutMs = timeout === undefined ? undefined : Number(timeout);

    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new Error(`Invalid --timeout ${JSON.stringify(timeout)}: expected milliseconds.`);
    }

    const report = await traceRequest({
      method,
      url,
      body: parseTraceBody(stringOption(options.body)),
      headers: parseHeaderValues(collectHeaderValues(process.argv)),
      serverUrl: stringOption(options.url),
      devtoolsPath: stringOption(options.devtoolsPath),
      requestIdHeader: stringOption(options.idHeader),
      timeoutMs,
    });

    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const [heading, ...rest] = formatTraceSummary(report);

    console.log(colors.bold(heading ?? ""));

    for (const line of rest) {
      console.log(line);
    }
  } catch (error) {
    const code = errorCodeOf(error) ?? null;
    const message = error instanceof Error ? error.message : String(error);

    if (json) {
      console.log(JSON.stringify({ ok: false, code, message }, null, 2));
    } else {
      console.error(colors.red(`${code ? `${code} ` : ""}${message}`));

      if (code) console.error(`  → ${ERROR_CODES[code].fix}`);
    }

    await flushAndExit(traceFailureExitCode(error));
  }
}
