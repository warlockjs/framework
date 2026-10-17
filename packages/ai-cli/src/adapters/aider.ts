import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  CliAdapter,
  CliLaunchContext,
  CliLaunchFile,
  CliParsedEvent,
  CliStreamParser,
} from "../contracts";
import { numberField, parseJsonLine, recordField, stringField } from "../stream/json-lines";
import { argvPrompt, mapEffort, promptFile, unsupportedOption, usageOf } from "./shared";

/** Local analytics log the adapter asks Aider to write (exact token counts). */
const ANALYTICS_LOG = "aider-analytics.jsonl";

/**
 * Aider (`aider`, PyPI `aider-chat`).
 *
 * Verified against the official docs (`aider.chat/docs/scripting.html`,
 * `/docs/config/options.html`, `/docs/config/reasoning.html`) and the
 * source at tag v0.86.2 (`aider/main.py`, `aider/args.py`,
 * `aider/coders/base_coder.py`, `aider/analytics.py`); Aider needs Python
 * 3.10+, so no real `--help` was run, 2026-10-17. The capability probe
 * checks every flag against the installed `--help`.
 *
 * - Headless: `aider --message <text>` (or `--message-file`). Aider has **no
 *   machine-readable output**: the parser reads the plain-text stdout —
 *   startup banner (`Main model: …`), the reply, the usage line
 *   (`Tokens: 2.4k sent, 61 received. Cost: $0.0081 message, …`),
 *   `Applied edit to <path>` (reported as an `edit` tool call) and
 *   `Commit <hash> <message>`. Exact token counts and cost come from the
 *   local `--analytics-log` file (`message_send` events), read when the
 *   stream ends.
 * - Aider exits 0 even when the model call fails, so `litellm.*Error` lines
 *   and the "not able to authenticate you" notice are reported as fatal.
 * - Permissions: Aider applies edits without approval and, headless with
 *   `--yes-always`, never runs the shell commands it suggests; there is no
 *   stricter or looser mode, so `standard` and `bypass` behave the same.
 *   Auto-commits are turned off (`--no-auto-commits`); pass
 *   `args: ["--auto-commits"]` to keep them.
 * - No session ids (`resume` is refused) and no MCP. Chat and input
 *   history are written to the run directory, not the repository.
 * - Home: Aider uses `HOME`; provider keys use their own variables
 *   (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) via `env`. Always pass
 *   `model` — without one Aider may start an interactive OAuth flow.
 */
export const aiderAdapter: CliAdapter = {
  name: "aider",
  title: "Aider",
  command: "aider",
  apiKeyEnv: [],
  homeEnv: ["HOME", "USERPROFILE"],
  transports: ["argv", "file"],
  effort: true,
  mcp: false,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "0.86.2",
    verifiedBy: "docs",
    sources: [
      "https://aider.chat/docs/scripting.html",
      "https://aider.chat/docs/config/options.html",
      "https://aider.chat/docs/config/reasoning.html",
      "https://github.com/Aider-AI/aider/tree/v0.86.2",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    if (context.resume !== undefined) {
      throw unsupportedOption(
        aiderAdapter,
        "Aider has no session ids, so `resume` is not supported.",
      );
    }

    const args = [
      "--yes-always",
      "--no-pretty",
      "--no-stream",
      "--no-fancy-input",
      "--no-auto-commits",
      "--no-check-update",
      "--no-show-release-notes",
      "--no-analytics",
      "--no-show-model-warnings",
      "--no-gitignore",
      "--analytics-log",
      path.join(context.runDir, ANALYTICS_LOG),
      "--chat-history-file",
      path.join(context.runDir, "chat-history.md"),
      "--input-history-file",
      path.join(context.runDir, "input-history"),
    ];
    const requires = [
      "--yes-always",
      "--no-pretty",
      "--no-stream",
      "--no-auto-commits",
      "--analytics-log",
      "--chat-history-file",
      "--input-history-file",
    ];
    const files: CliLaunchFile[] = [];
    let tail: string[];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      args.push(
        "--reasoning-effort",
        mapEffort(context.effort, { low: "low", medium: "medium", high: "high" }),
      );
      requires.push("--reasoning-effort");
    }

    if (context.transport === "file") {
      const prompt = promptFile(context);

      files.push(prompt);
      tail = ["--message-file", prompt.path];
      requires.push("--message-file");
    } else {
      tail = ["--message", argvPrompt(context.prompt)];
      requires.push("--message");
    }

    return {
      args,
      tail,
      env: {
        ...(context.home !== undefined ? { HOME: context.home, USERPROFILE: context.home } : {}),
        TERM: "dumb",
      },
      files,
      requires,
    };
  },
  parser: createAiderParser,
};

/** `2.4k` → 2400, `12k` → 12000, `61` → 61. */
export function parseAiderCount(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const match = /^([\d.]+)(k|M)?$/.exec(value.trim());

  if (!match) {
    return undefined;
  }

  const number = Number(match[1]);
  const scale = match[2] === "k" ? 1_000 : match[2] === "M" ? 1_000_000 : 1;

  return Number.isFinite(number) ? Math.round(number * scale) : undefined;
}

const TOKENS_LINE =
  /^Tokens: ([\d.]+[kM]?) sent(?:, ([\d.]+[kM]?) cache write)?(?:, ([\d.]+[kM]?) cache hit)?, ([\d.]+[kM]?) received\.(?:\s+Cost: \$([\d.]+) message, \$([\d.]+) session\.)?/;

const BANNER = [
  /^Aider v\d/,
  /^Main model: /,
  /^Weak model: /,
  /^Editor model: /,
  /^Model: /,
  /^Git repo: /,
  /^Repo-map: /,
  /^Added .+ to the chat\.$/,
  /^Cost: \$[\d.]+ message, \$[\d.]+ session\.$/,
  /^Use \/help /,
];

/** Usage from the analytics log (`message_send` events), summed. */
function analyticsUsage(context: CliLaunchContext | undefined): CliParsedEvent | undefined {
  if (context === undefined) {
    return undefined;
  }

  let content: string;

  try {
    content = readFileSync(path.join(context.runDir, ANALYTICS_LOG), "utf8");
  } catch {
    return undefined;
  }

  let input = 0;
  let output = 0;
  let cost: number | undefined;
  let seen = false;

  for (const line of content.split(/\r?\n/)) {
    const record = parseJsonLine(line);

    if (stringField(record, "event") !== "message_send") {
      continue;
    }

    const properties = recordField(record, "properties");

    seen = true;
    input += numberField(properties, "prompt_tokens") ?? 0;
    output += numberField(properties, "completion_tokens") ?? 0;

    const messageCost = numberField(properties, "cost");

    if (messageCost !== undefined) {
      cost = (cost ?? 0) + messageCost;
    }
  }

  return seen
    ? { type: "usage", cumulative: true, usage: usageOf({ input, output, costUSD: cost }) }
    : undefined;
}

/** Parser for Aider's plain-text stdout (plus its analytics log). */
export function createAiderParser(context?: CliLaunchContext): CliStreamParser {
  let started = false;
  let body: string[] = [];

  const flush = (): CliParsedEvent[] => {
    const text = body.join("\n").trim();

    body = [];

    return text.length > 0 ? [{ type: "message", text, delta: false }] : [];
  };

  return {
    line(line: string): CliParsedEvent[] {
      const events: CliParsedEvent[] = [];
      const model = /^Main model: (\S+)/.exec(line);

      // One `session.started`: on the model line of the banner, or on the
      // first line of output when the banner has none.
      if (
        !started &&
        (model || (line.trim().length > 0 && !BANNER.some((pattern) => pattern.test(line))))
      ) {
        started = true;
        events.push({ type: "session.started", model: model?.[1] });
      }

      if (BANNER.some((pattern) => pattern.test(line))) {
        return events;
      }

      const tokens = TOKENS_LINE.exec(line);

      if (tokens) {
        const cacheWrite = parseAiderCount(tokens[2]);
        const cacheHit = parseAiderCount(tokens[3]);
        const sent = parseAiderCount(tokens[1]) ?? 0;

        events.push(...flush(), {
          type: "usage",
          cumulative: false,
          usage: usageOf({
            input: sent,
            output: parseAiderCount(tokens[4]),
            cachedTokens: cacheHit,
            cacheWriteTokens: cacheWrite,
            costUSD: tokens[5] !== undefined ? Number(tokens[5]) : undefined,
          }),
        });

        return events;
      }

      const applied = /^Applied edit to (.+)$/.exec(line);

      if (applied) {
        const file = applied[1] ?? "";
        const id = `edit-${file}`;

        events.push(
          ...flush(),
          { type: "tool.call", id, name: "edit", input: { path: file } },
          { type: "tool.result", id, output: line, isError: false },
        );

        return events;
      }

      const commit = /^Commit ([0-9a-f]{7,40}) (.*)$/.exec(line);

      if (commit) {
        const id = `commit-${commit[1] ?? ""}`;

        events.push(
          { type: "tool.call", id, name: "commit", input: { hash: commit[1], message: commit[2] } },
          { type: "tool.result", id, output: line, isError: false },
        );

        return events;
      }

      if (
        /^litellm\.\w+Error:/.test(line) ||
        line.startsWith("The API provider is not able to authenticate you")
      ) {
        events.push({ type: "error", message: line, fatal: true });

        return events;
      }

      if (/^Retrying in [\d.]+ seconds/.test(line)) {
        events.push({ type: "error", message: line });

        return events;
      }

      body.push(line);

      return events;
    },
    end(): CliParsedEvent[] {
      const events = flush();
      const usage = analyticsUsage(context);

      return usage !== undefined ? [...events, usage] : events;
    },
  };
}
