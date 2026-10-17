import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  CliAdapter,
  CliLaunchContext,
  CliLaunchFile,
  CliMcpServers,
  CliParsedEvent,
  CliStreamParser,
} from "../contracts";
import {
  asArray,
  asRecord,
  jsonLinesParser,
  numberField,
  outputText,
  parseJsonLine,
  recordField,
  stringField,
} from "../stream/json-lines";
import { type TomlTable, toToml } from "../utils/toml";
import { argvPrompt, promptFile, requirePrivateHome, usageOf } from "./shared";

/** Folder (inside the run directory) Vibe writes `export.json` to. */
const EXPORT_DIR = "vibe-output";

/**
 * Mistral Vibe (`vibe`, PyPI `mistral-vibe`).
 *
 * Verified against the official repo at tag v2.26.1 only (README,
 * `vibe/cli/entrypoint.py`, `vibe/cli/programmatic.py`,
 * `vibe/app_server/run_export.py`, `vibe/core/config/*`); Vibe needs Python
 * 3.12, so no real `--help` was run, 2026-10-17. The capability probe checks
 * every flag against the installed `--help`.
 *
 * - Headless: `vibe -p <prompt> --output streaming` (or `--prompt-file`;
 *   `-p` with no value reads stdin). The stream is NDJSON of completed
 *   history entries (camelCase): `message` (`role`, `content[].text`), and
 *   `effect` — a tool call and its result in one line (`detail.toolName`,
 *   `detail.input`, `state.status`, `state.outputText`/`state.error`).
 *   There is no usage, cost or final record in the stream, so the adapter
 *   adds `--output-dir` and reads usage, cost, session id and outcome from
 *   `export.json` when the stream ends.
 * - Model: no flag; `VIBE_ACTIVE_MODEL=<alias>` (set from `model`). Effort
 *   is a per-model config field, so `effort` is refused.
 * - Permissions: headless auto-denies every approval (the default agent
 *   only auto-approves file edits); bypass is `--auto-approve`.
 * - MCP: `[[mcp_servers]]` in `$VIBE_HOME/config.toml` (private home).
 * - Auth: `MISTRAL_API_KEY`; home `VIBE_HOME`.
 */
export const mistralVibeAdapter: CliAdapter = {
  name: "mistral-vibe",
  title: "Mistral Vibe",
  command: "vibe",
  apiKeyEnv: ["MISTRAL_API_KEY"],
  homeEnv: ["VIBE_HOME"],
  transports: ["argv", "file", "stdin"],
  effort: false,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "2.26.1",
    verifiedBy: "docs",
    sources: [
      "https://github.com/mistralai/mistral-vibe/blob/v2.26.1/README.md",
      "https://github.com/mistralai/mistral-vibe/blob/v2.26.1/vibe/cli/entrypoint.py",
      "https://github.com/mistralai/mistral-vibe/blob/v2.26.1/vibe/cli/programmatic.py",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["--output", "streaming", "--output-dir", path.join(context.runDir, EXPORT_DIR)];
    const requires = ["--output", "streaming", "--output-dir"];
    const files: CliLaunchFile[] = [];
    const env: Record<string, string> = {};

    if (context.model !== undefined) {
      env.VIBE_ACTIVE_MODEL = context.model;
    }

    if (context.resume !== undefined) {
      args.push("--resume", context.resume);
      requires.push("--resume");
    }

    if (context.permission === "bypass") {
      args.push("--auto-approve");
      requires.push("--auto-approve");
    }

    if (context.mcp !== undefined) {
      const home = requirePrivateHome(context, mistralVibeAdapter, "MCP servers");

      files.push({
        path: path.join(home, "config.toml"),
        content: toToml({ mcp_servers: vibeMcp(context.mcp) }),
      });
    }

    if (context.home !== undefined) {
      env.VIBE_HOME = context.home;
    }

    if (context.transport === "file") {
      const prompt = promptFile(context);

      files.push(prompt);
      requires.push("--prompt-file");

      return { args, tail: ["--prompt-file", prompt.path], env, files, requires };
    }

    requires.push("-p");

    if (context.transport === "stdin") {
      return { args, tail: ["-p"], stdin: context.prompt, env, files, requires };
    }

    return { args, tail: ["-p", argvPrompt(context.prompt)], env, files, requires };
  },
  parser: createVibeParser,
};

function vibeMcp(servers: CliMcpServers): TomlTable[] {
  return Object.entries(servers).map(([name, server]): TomlTable =>
    server.type === "stdio"
      ? {
          name,
          transport: "stdio",
          command: server.command,
          args: server.args ?? [],
          env: server.env,
        }
      : {
          name,
          transport: server.type === "http" ? "streamable-http" : "http",
          url: server.url,
          auth:
            server.headers !== undefined ? { type: "static", headers: server.headers } : undefined,
        },
  );
}

/** Read Vibe's `export.json`: usage, cost, session id and outcome of the run. */
function exportEvents(context: CliLaunchContext | undefined): {
  events: CliParsedEvent[];
  sessionRef?: string;
} {
  if (context === undefined) {
    return { events: [] };
  }

  let report: Record<string, unknown> | undefined;

  try {
    report = parseJsonLine(
      readFileSync(path.join(context.runDir, EXPORT_DIR, "export.json"), "utf8"),
    );
  } catch {
    return { events: [] };
  }

  if (report === undefined) {
    return { events: [] };
  }

  const events: CliParsedEvent[] = [];
  const usage = recordField(report, "usage");

  if (usage !== undefined) {
    const cached = numberField(usage, "cached_input_tokens");

    events.push({
      type: "usage",
      cumulative: true,
      usage: usageOf({
        input: numberField(usage, "input_tokens"),
        output: numberField(usage, "output_tokens"),
        total: numberField(usage, "total_tokens"),
        cachedTokens: cached !== undefined && cached > 0 ? cached : undefined,
        costUSD: numberField(report, "cost_usd"),
      }),
      raw: report,
    });
  }

  const outcome = stringField(report, "outcome");

  if (outcome !== undefined && outcome !== "finished") {
    events.push({
      type: "error",
      message:
        stringField(recordField(report, "error"), "message") ?? `Mistral Vibe stopped: ${outcome}`,
      fatal: true,
      raw: report,
    });
  }

  return { events, sessionRef: stringField(report, "session_id") };
}

/** Parser for `vibe -p … --output streaming` (plus the run's `export.json`). */
export function createVibeParser(context?: CliLaunchContext): CliStreamParser {
  let started = false;
  let sessionRef: string | undefined;

  const parser = jsonLinesParser(
    (record): CliParsedEvent[] => {
      const events: CliParsedEvent[] = [];
      const session = stringField(record, "sessionId");

      if (session !== undefined) {
        sessionRef = session;
      }

      if (!started) {
        started = true;
        events.push({ type: "session.started", sessionRef: session, raw: record });
      }

      switch (stringField(record, "type")) {
        case "message": {
          if (stringField(record, "role") !== "assistant") {
            break;
          }

          const text = asArray(record.content)
            .map((block) => stringField(asRecord(block), "text") ?? "")
            .join("");

          if (text.length > 0) {
            events.push({ type: "message", text, delta: false, raw: record });
          }
          break;
        }
        case "effect": {
          const detail = recordField(record, "detail");
          const state = recordField(record, "state");
          const status = stringField(state, "status");
          const id = stringField(record, "id") ?? "";

          events.push({
            type: "tool.call",
            id,
            name: stringField(detail, "toolName") ?? stringField(record, "title") ?? "",
            input: detail?.input,
            raw: record,
          });

          if (
            status === "completed" ||
            status === "failed" ||
            status === "cancelled" ||
            status === "skipped"
          ) {
            const error = stringField(recordField(state, "error"), "message");

            events.push({
              type: "tool.result",
              id,
              output: error ?? stringField(state, "outputText") ?? outputText(state?.output),
              isError: status !== "completed",
              raw: record,
            });
          }
          break;
        }
        case "notice":
          if (stringField(record, "level") === "error") {
            events.push({
              type: "error",
              message: stringField(record, "message") ?? "error",
              raw: record,
            });
          }
          break;
      }

      return events;
    },
    () => {
      const exported = exportEvents(context);

      sessionRef = exported.sessionRef ?? sessionRef;

      return exported.events;
    },
  );

  return { ...parser, sessionRef: () => sessionRef };
}
