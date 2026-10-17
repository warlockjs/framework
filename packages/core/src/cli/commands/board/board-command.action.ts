import { readFileSync } from "node:fs";
import path from "node:path";
import type { CommandActionData } from "../../../commands/types";
import { WarlockError } from "../../../errors/warlock-error";
import {
  addBoardItem,
  initBoard,
  moveBoardItem,
  nextBoardStates,
  readBoardItem,
  readBoardStatus,
  sendBoardMessage,
  watchBoard,
} from "../../../tooling/board/board";
import {
  BOARD_STATES,
  BOARD_VERDICT_LINES,
  type BoardItem,
  type BoardMessage,
  type BoardState,
  type BoardVerdict,
  isBoardState,
  isBoardVerdict,
} from "../../../tooling/board/board.types";
import { flushAndExit } from "../../flush-and-exit";

/** The exit code of `warlock board watch` when it times out. */
export const BOARD_WATCH_TIMEOUT_EXIT_CODE = 3;

/** The sub-commands of `warlock board`. */
export const BOARD_ACTIONS = ["init", "add", "status", "send", "watch"] as const;

/** One parsed `warlock board …` invocation. */
export type BoardInvocation =
  | { type: "init" }
  | {
      type: "add";
      title: string;
      assignee: string | null;
      reviewer: string | null;
      by: string | null;
    }
  | { type: "overview" }
  | { type: "item"; id: number }
  | { type: "move"; id: number; state: BoardState; by: string | null; note: string | null }
  | {
      type: "send";
      to: string;
      from: string;
      subject: string;
      body: string;
      item: number | null;
      verdict: BoardVerdict | null;
    }
  | { type: "watch"; agent: string; timeoutMs: number; since: number | undefined };

type Options = CommandActionData["options"];

function stringOption(options: Options, key: string): string | undefined {
  const value = options[key];

  if (typeof value === "number") return String(value);

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseId(value: string | undefined, label: string): number {
  const id = value === undefined ? Number.NaN : Number(value);

  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`${label} must be a positive whole number, got ${JSON.stringify(value)}.`);
  }

  return id;
}

/** `--body text` as is; `--body @notes.md` reads the file (relative to `cwd`). */
export function readBodyOption(value: string | undefined, cwd: string): string {
  if (value === undefined) return "";

  return value.startsWith("@") ? readFileSync(path.resolve(cwd, value.slice(1)), "utf8") : value;
}

/** The current agent: the explicit option, else `WARLOCK_AGENT`, else `null`. */
function agentOf(options: Options, key: string, environment: NodeJS.ProcessEnv): string | null {
  return stringOption(options, key) ?? environment.WARLOCK_AGENT ?? null;
}

/**
 * Turn `warlock board <action> [args...]` into a {@link BoardInvocation}.
 * Throws on an unknown action, a missing argument or an invalid value.
 *
 * @param args Positionals after `board`: the action first.
 * @param options Parsed flags.
 * @param cwd Where `--body @file` resolves.
 * @param environment Where `WARLOCK_AGENT` is read.
 */
export function parseBoardInvocation(
  args: readonly string[],
  options: Options,
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): BoardInvocation {
  const [action, ...rest] = args;

  switch (action) {
    case "init":
      return { type: "init" };

    case "add": {
      const title = rest.join(" ").trim();

      if (title.length === 0)
        throw new Error('Usage: warlock board add "<title>" [--assignee a --reviewer b]');

      return {
        type: "add",
        title,
        assignee: stringOption(options, "assignee") ?? null,
        reviewer: stringOption(options, "reviewer") ?? null,
        by: agentOf(options, "by", environment),
      };
    }

    case "status": {
      const [idText, state] = rest;

      if (idText === undefined) return { type: "overview" };

      const id = parseId(idText, "The item id");

      if (state === undefined) return { type: "item", id };

      if (!isBoardState(state)) {
        throw new Error(
          `Unknown state ${JSON.stringify(state)}. States: ${BOARD_STATES.join(", ")}.`,
        );
      }

      return {
        type: "move",
        id,
        state,
        by: agentOf(options, "by", environment),
        note: stringOption(options, "note") ?? null,
      };
    }

    case "send": {
      const [to, ...subjectWords] = rest;
      const subject = subjectWords.join(" ").trim();

      if (to === undefined || subject.length === 0) {
        throw new Error(
          'Usage: warlock board send <agent> "<subject>" --from <agent> [--item id --body text|@file --verdict approved|changes-requested]',
        );
      }

      const from = agentOf(options, "from", environment);

      if (from === null) {
        throw new Error("Name the sender with --from <agent> (or set WARLOCK_AGENT).");
      }

      const verdict = stringOption(options, "verdict");

      if (verdict !== undefined && !isBoardVerdict(verdict)) {
        throw new Error(
          `--verdict must be "approved" or "changes-requested", got ${JSON.stringify(verdict)}.`,
        );
      }

      const item = stringOption(options, "item");

      return {
        type: "send",
        to,
        from,
        subject,
        body: readBodyOption(stringOption(options, "body"), cwd),
        item: item === undefined ? null : parseId(item, "--item"),
        verdict: verdict ?? null,
      };
    }

    case "watch": {
      const [agent] = rest;

      if (agent === undefined)
        throw new Error("Usage: warlock board watch <agent> [--timeout seconds --since N]");

      const timeout = stringOption(options, "timeout");
      const seconds = timeout === undefined ? 600 : Number(timeout);

      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(
          `--timeout must be a positive number of seconds, got ${JSON.stringify(timeout)}.`,
        );
      }

      const since = stringOption(options, "since");
      const sinceNumber = since === undefined ? undefined : Number(since);

      if (sinceNumber !== undefined && (!Number.isInteger(sinceNumber) || sinceNumber < 0)) {
        throw new Error(`--since must be a whole number, got ${JSON.stringify(since)}.`);
      }

      return { type: "watch", agent, timeoutMs: Math.round(seconds * 1000), since: sinceNumber };
    }

    default:
      throw new Error(
        `Unknown board action ${JSON.stringify(action ?? "")}. Actions: ${BOARD_ACTIONS.join(", ")}.`,
      );
  }
}

/** `#3 [in-progress] Add the orders module  (implementer → reviewer)` */
export function formatBoardItemLine(item: BoardItem): string {
  const people =
    item.assignee || item.reviewer ? `  (${item.assignee ?? "-"} → ${item.reviewer ?? "-"})` : "";

  return `#${item.id} [${item.state}] ${item.title}${people}`;
}

function formatMessage(message: BoardMessage): string[] {
  const about = message.item === null ? "" : ` (item #${message.item})`;

  return [
    `── ${message.file}`,
    `From ${message.from}${about}: ${message.subject}`,
    ...(message.body.length > 0 ? ["", message.body] : []),
    ...(message.verdict ? ["", BOARD_VERDICT_LINES[message.verdict]] : []),
    "",
  ];
}

/** What one invocation produced: the JSON to print, the human lines, and the exit code. */
export type BoardOutcome = { json: unknown; lines: string[]; exitCode: number };

/** Run one parsed invocation against the board in `cwd`. Throws `WarlockError`s with WL74xx codes. */
export async function runBoardInvocation(
  invocation: BoardInvocation,
  cwd = process.cwd(),
): Promise<BoardOutcome> {
  switch (invocation.type) {
    case "init": {
      const result = initBoard(cwd);

      return {
        json: { ok: true, ...result },
        lines: [
          result.created ? `Created ${result.directory}/` : `${result.directory}/ already exists`,
          ...(result.gitignoreUpdated ? [`Added ${result.directory}/ to .gitignore`] : []),
        ],
        exitCode: 0,
      };
    }

    case "add": {
      const item = addBoardItem(
        {
          title: invocation.title,
          assignee: invocation.assignee,
          reviewer: invocation.reviewer,
          by: invocation.by,
        },
        cwd,
      );

      return {
        json: { ok: true, item },
        lines: [`Added ${formatBoardItemLine(item)}`],
        exitCode: 0,
      };
    }

    case "overview": {
      const status = readBoardStatus(cwd);
      const lines =
        status.items.length === 0
          ? ['No items. Add one with `warlock board add "<title>"`.']
          : status.items.map(formatBoardItemLine);

      if (status.inboxes.length > 0) {
        lines.push("", "Inboxes:");

        for (const inbox of status.inboxes) {
          lines.push(
            `  ${inbox.agent.padEnd(16)} ${inbox.messages} message(s), ${inbox.unread} unread`,
          );
        }
      }

      return { json: { ok: true, ...status }, lines, exitCode: 0 };
    }

    case "item": {
      const item = readBoardItem(invocation.id, cwd);
      const next = nextBoardStates(item.state);

      return {
        json: { ok: true, item, next },
        lines: [
          formatBoardItemLine(item),
          `  next: ${next.join(", ")}`,
          ...item.history.map(
            (entry) =>
              `  ${entry.at}  ${entry.from ?? "∅"} → ${entry.to}${entry.by ? ` by ${entry.by}` : ""}${entry.note ? ` — ${entry.note}` : ""}`,
          ),
        ],
        exitCode: 0,
      };
    }

    case "move": {
      const item = moveBoardItem(
        invocation.id,
        invocation.state,
        { by: invocation.by, note: invocation.note },
        cwd,
      );

      return {
        json: { ok: true, item },
        lines: [`Moved ${formatBoardItemLine(item)}`],
        exitCode: 0,
      };
    }

    case "send": {
      const result = sendBoardMessage(
        {
          to: invocation.to,
          from: invocation.from,
          subject: invocation.subject,
          body: invocation.body,
          item: invocation.item,
          verdict: invocation.verdict,
        },
        cwd,
      );

      return {
        json: { ok: true, ...result },
        lines: [
          `Wrote ${result.message.file}`,
          ...(result.item ? [`Moved ${formatBoardItemLine(result.item)}`] : []),
        ],
        exitCode: 0,
      };
    }

    case "watch": {
      const result = await watchBoard(
        { agent: invocation.agent, timeoutMs: invocation.timeoutMs, since: invocation.since },
        cwd,
      );

      return {
        json: { ok: true, timedOut: false, ...result },
        lines: result.messages.flatMap(formatMessage),
        exitCode: 0,
      };
    }
  }
}

/**
 * Action behind `warlock board <action> [args...]`.
 *
 * With `--json`, stdout carries exactly one JSON object — `{ ok: true, … }`, or
 * `{ ok: false, code, message }` for a coded failure (`timedOut: true` for a
 * watch timeout). Exit codes: 0 done, 1 refused or invalid, 3 watch timed out.
 *
 * @param data Parsed CLI args: the action and its positionals, and the flags.
 */
export async function boardCommandAction({ args, options }: CommandActionData): Promise<void> {
  const json = options.json === true;

  try {
    const outcome = await runBoardInvocation(parseBoardInvocation(args, options));

    if (json) {
      console.log(JSON.stringify(outcome.json, null, 2));
    } else {
      for (const line of outcome.lines) console.log(line);
    }

    if (outcome.exitCode !== 0) await flushAndExit(outcome.exitCode);
  } catch (error) {
    const timedOut = error instanceof WarlockError && error.code === "WL7404";
    const exitCode = timedOut ? BOARD_WATCH_TIMEOUT_EXIT_CODE : 1;

    if (!json && !timedOut) throw error;

    const message = error instanceof Error ? error.message : String(error);

    if (json) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            code: error instanceof WarlockError ? error.code : null,
            message,
            ...(timedOut ? { timedOut: true } : {}),
          },
          null,
          2,
        ),
      );
    } else {
      console.error(message);
    }

    await flushAndExit(exitCode);
  }
}
