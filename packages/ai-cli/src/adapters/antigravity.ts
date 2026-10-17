import path from "node:path";
import type {
  CliAdapter,
  CliLaunchFile,
  CliMcpServers,
  CliParsedEvent,
  CliStreamParser,
} from "../contracts";
import {
  jsonLinesParser,
  numberField,
  recordField,
  stringField,
  type JsonRecord,
} from "../stream/json-lines";
import { argvPrompt, jsonFile, mapEffort, requirePrivateHome, usageOf } from "./shared";

/**
 * Google Antigravity CLI (`agy`), installed by the
 * `antigravity.google/cli/install.sh` script (no npm package). Not Gemini
 * CLI, which it succeeds.
 *
 * Verified against the official docs only (the binary is distributed by a
 * curl installer, which was not run): `antigravity.google/docs/cli/headless`,
 * `/docs/cli/reference`, `/docs/mcp`, `/docs/permissions`, `/docs/settings`,
 * `/docs/install`, and the 1.4.0 release notes, 2026-10-17. The capability
 * probe checks every flag against the installed binary's `--help`.
 *
 * - Headless: `agy -p <prompt> --output-format stream-json`. For long
 *   prompts the adapter uses the documented stdin protocol instead:
 *   `--input-format stream-json` with one `{"event":"user","message":
 *   {"content":…}}` line, then stdin is closed.
 * - Stream: `{"event":X, X:{…}}` lines — `init` (with `conversation_id`),
 *   `step_update` (`agent_response` steps carry `text_delta` fragments;
 *   `tool` steps carry `tool_info{name,parameters,output,error}` with call
 *   and result together, correlated by `step_index`) and a final `result`
 *   (`status`, `response`, `error`, cumulative `usage`). No cost field.
 * - Permissions: headless soft-denies tools that need approval (the run
 *   continues and exits 0); bypass is `--dangerously-skip-permissions`.
 * - Home: no variable relocates `~/.gemini`, so a private/owned home sets
 *   `HOME` (and `USERPROFILE`). MCP goes to
 *   `$HOME/.gemini/config/mcp_config.json` (remote servers use `serverUrl`).
 * - Auth: `GEMINI_API_KEY` only works with `"modelProvider": "gemini"` in
 *   `$HOME/.gemini/antigravity-cli/settings.json`; the adapter writes that
 *   file when `apiKey` is set on a private home.
 */
export const antigravityAdapter: CliAdapter = {
  name: "antigravity",
  title: "Antigravity CLI",
  command: "agy",
  apiKeyEnv: ["GEMINI_API_KEY"],
  homeEnv: ["HOME", "USERPROFILE"],
  transports: ["argv", "stdin"],
  effort: true,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "1.4.0",
    verifiedBy: "docs",
    sources: [
      "https://antigravity.google/docs/cli/headless",
      "https://antigravity.google/docs/cli/reference",
      "https://antigravity.google/docs/mcp",
      "https://antigravity.google/docs/permissions",
      "https://github.com/google-antigravity/antigravity-cli",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["--output-format", "stream-json"];
    const requires = ["--output-format", "stream-json"];
    const files: CliLaunchFile[] = [];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      // Documented levels: low | medium | high.
      args.push(
        "--effort",
        mapEffort(context.effort, { low: "low", medium: "medium", high: "high" }),
      );
      requires.push("--effort");
    }

    if (context.resume !== undefined) {
      args.push("--conversation", context.resume);
      requires.push("--conversation");
    }

    if (context.permission === "bypass") {
      args.push("--dangerously-skip-permissions");
      requires.push("--dangerously-skip-permissions");
    }

    if (context.mcp !== undefined) {
      const home = requirePrivateHome(context, antigravityAdapter, "MCP servers");

      files.push({
        path: path.join(home, ".gemini", "config", "mcp_config.json"),
        content: jsonFile({ mcpServers: antigravityMcp(context.mcp) }),
      });
    }

    if (context.apiKey !== undefined && context.homeIsPrivate && context.home !== undefined) {
      files.push({
        path: path.join(context.home, ".gemini", "antigravity-cli", "settings.json"),
        content: jsonFile({ modelProvider: "gemini" }),
      });
    }

    const env: Record<string, string> =
      context.home !== undefined ? { HOME: context.home, USERPROFILE: context.home } : {};

    if (context.transport === "stdin") {
      // Documented form: `agy --input-format stream-json --output-format stream-json`, no `-p`.
      args.push("--input-format", "stream-json");
      requires.push("--input-format");

      return {
        args,
        stdin: `${JSON.stringify({ event: "user", message: { content: context.prompt } })}\n`,
        env,
        files,
        requires,
      };
    }

    requires.push("-p");

    return { args, tail: ["-p", argvPrompt(context.prompt)], env, files, requires };
  },
  parser: createAntigravityParser,
};

function antigravityMcp(servers: CliMcpServers): Record<string, unknown> {
  const rendered: Record<string, unknown> = {};

  for (const [name, server] of Object.entries(servers)) {
    rendered[name] =
      server.type === "stdio"
        ? {
            command: server.command,
            args: server.args ?? [],
            ...(server.env ? { env: server.env } : {}),
          }
        : { serverUrl: server.url, ...(server.headers ? { headers: server.headers } : {}) };
  }

  return rendered;
}

function stepUsage(usage: JsonRecord | undefined) {
  if (usage === undefined) {
    return undefined;
  }

  const cached = numberField(usage, "cache_read_tokens");

  return usageOf({
    input: numberField(usage, "input_tokens"),
    output: numberField(usage, "output_tokens"),
    total: numberField(usage, "total_tokens"),
    cachedTokens: cached !== undefined && cached > 0 ? cached : undefined,
    reasoningTokens: numberField(usage, "thinking_tokens") || undefined,
  });
}

/** Parser for `agy -p … --output-format stream-json`. */
export function createAntigravityParser(): CliStreamParser {
  return jsonLinesParser((record): CliParsedEvent[] => {
    const event = stringField(record, "event");

    if (event === "init") {
      const init = recordField(record, "init");

      return [
        {
          type: "session.started",
          sessionRef: stringField(record, "conversation_id"),
          model: stringField(init, "model"),
          raw: record,
        },
      ];
    }

    if (event === "step_update") {
      const step = recordField(record, "step_update");
      const stepType = stringField(step, "step_type");
      const events: CliParsedEvent[] = [];

      if (stepType === "agent_response") {
        const text = stringField(step, "text_delta") ?? "";

        if (text.length > 0) {
          events.push({ type: "message", text, delta: true, raw: record });
        }
      }

      if (stepType === "tool" && stringField(step, "state") === "DONE") {
        const info = recordField(step, "tool_info");
        const error = recordField(info, "error");
        const id = `step-${numberField(step, "step_index") ?? 0}`;

        events.push(
          {
            type: "tool.call",
            id,
            name: stringField(info, "name") ?? stringField(step, "tool_name") ?? "",
            input: info?.parameters,
            raw: record,
          },
          {
            type: "tool.result",
            id,
            output:
              error !== undefined
                ? (stringField(error, "message") ?? stringField(error, "type") ?? "tool failed")
                : (stringField(info, "output") ?? ""),
            isError: error !== undefined,
            raw: record,
          },
        );
      }

      const usage = stepUsage(recordField(step, "usage"));

      if (usage !== undefined) {
        events.push({ type: "usage", usage, cumulative: false, raw: record });
      }

      return events;
    }

    if (event === "result") {
      const result = recordField(record, "result");
      const events: CliParsedEvent[] = [];
      const usage = stepUsage(recordField(result, "usage"));

      if (usage !== undefined) {
        events.push({ type: "usage", usage, cumulative: true, raw: record });
      }

      const status = stringField(result, "status");

      if (status !== undefined && status !== "SUCCESS") {
        events.push({
          type: "error",
          message: stringField(result, "error") || `Antigravity run ended ${status}`,
          fatal: true,
          raw: record,
        });
      } else {
        const response = stringField(result, "response") ?? "";

        if (response.length > 0) {
          events.push({ type: "message", text: response, delta: false, final: true, raw: record });
        }
      }

      return events;
    }

    return [];
  });
}
