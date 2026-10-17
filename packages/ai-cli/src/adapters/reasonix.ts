import path from "node:path";
import type {
  CliAdapter,
  CliLaunchFile,
  CliMcpServers,
  CliParsedEvent,
  CliStreamParser,
  CliUsage,
} from "../contracts";
import {
  asRecord,
  jsonLinesParser,
  numberField,
  recordField,
  stringField,
  type JsonRecord,
} from "../stream/json-lines";
import { type TomlTable, toToml } from "../utils/toml";
import {
  argvPrompt,
  dotenvFile,
  mapEffort,
  parseArguments,
  requirePrivateHome,
  usageOf,
} from "./shared";

/**
 * Reasonix (`reasonix`, npm `reasonix`) — a cache-first coding agent built
 * around DeepSeek (now multi-provider); the npm package launches a prebuilt
 * Go binary.
 *
 * Verified against the real `reasonix run --help` / `--version` of 2.43.0,
 * real stream-json output (captured against a local fake model server) and
 * the docs at that tag (`docs/CLI.md`, `docs/CONFIG_PATHS.md`), 2026-10-17.
 *
 * - Headless: `reasonix run --output-format stream-json <task>`; with no
 *   positional task, piped stdin is the prompt.
 * - Stream: every line has `kind` (`text` deltas, `message` full text,
 *   `tool_dispatch`/`tool_started`/`tool_result` with a `tool` object whose
 *   non-empty `err` marks a failure, `usage` per model call, `turn_done`) plus
 *   `sessionId`; the final line is `{"type":"result",…}` with totals.
 * - Permissions: headless "ask" mode refuses writes (listed in
 *   `permission_denials`; exit 4 in an untrusted folder); bypass is `--yolo`.
 * - MCP: no flag; `[[plugins]]` in `$REASONIX_HOME/config.toml`.
 * - Auth: provider keys are read only from `$REASONIX_HOME/.env`, never the
 *   shell environment, so `apiKey` is written there (0600) as
 *   `DEEPSEEK_API_KEY` — this needs a private home. For another provider,
 *   put its variable in that file yourself via a caller-owned home.
 */
export const reasonixAdapter: CliAdapter = {
  name: "reasonix",
  title: "Reasonix",
  command: "reasonix",
  apiKeyEnv: ["DEEPSEEK_API_KEY"],
  homeEnv: ["REASONIX_HOME"],
  transports: ["argv", "stdin"],
  effort: true,
  mcp: true,
  probe: { help: [["run", "--help"]], version: ["--version"] },
  verification: {
    version: "2.43.0",
    verifiedBy: "help",
    sources: [
      "https://github.com/esengine/DeepSeek-Reasonix/blob/v2.43.0/docs/CLI.md",
      "https://github.com/esengine/DeepSeek-Reasonix/blob/v2.43.0/docs/CONFIG_PATHS.md",
      "https://www.npmjs.com/package/reasonix",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["run", "--output-format", "stream-json"];
    const requires = ["--output-format", "stream-json"];
    const files: CliLaunchFile[] = [];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      // DeepSeek levels per docs/REASONING_PROVIDERS.md: auto | disabled | low | high | max.
      args.push(
        "--effort",
        mapEffort(context.effort, { none: "disabled", low: "low", high: "high", max: "max" }),
      );
      requires.push("--effort");
    }

    if (context.resume !== undefined) {
      args.push("--resume", context.resume);
      requires.push("--resume");
    }

    if (context.permission === "bypass") {
      args.push("--yolo");
      requires.push("--yolo");
    }

    if (context.mcp !== undefined) {
      const home = requirePrivateHome(context, reasonixAdapter, "MCP servers");

      files.push({
        path: path.join(home, "config.toml"),
        content: toToml({ plugins: reasonixPlugins(context.mcp) }),
      });
    }

    if (context.apiKey !== undefined) {
      const home = requirePrivateHome(context, reasonixAdapter, "API keys (its .env file)");

      files.push({
        path: path.join(home, ".env"),
        content: dotenvFile({ DEEPSEEK_API_KEY: context.apiKey }),
      });
    }

    return {
      args,
      tail: context.transport === "argv" ? [argvPrompt(context.prompt)] : [],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env: {
        ...(context.home !== undefined ? { REASONIX_HOME: context.home } : {}),
        REASONIX_TELEMETRY: "off",
      },
      files,
      requires,
    };
  },
  parser: createReasonixParser,
};

function reasonixPlugins(servers: CliMcpServers): TomlTable[] {
  return Object.entries(servers).map(([name, server]): TomlTable =>
    server.type === "stdio"
      ? { name, type: "stdio", command: server.command, args: server.args ?? [], env: server.env }
      : { name, type: server.type, url: server.url, headers: server.headers },
  );
}

/** Reasonix per-call usage (`promptTokens` includes cache hits). */
function callUsage(usage: JsonRecord | undefined): CliUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const cacheHit = numberField(usage, "cacheHitTokens");

  return usageOf({
    input: numberField(usage, "promptTokens"),
    output: numberField(usage, "completionTokens"),
    total: numberField(usage, "totalTokens"),
    cachedTokens: cacheHit !== undefined && cacheHit > 0 ? cacheHit : undefined,
    reasoningTokens: numberField(usage, "reasoningTokens"),
    costUSD: numberField(usage, "costUsd"),
  });
}

/** Parser for `reasonix run --output-format stream-json`. */
export function createReasonixParser(): CliStreamParser {
  let started = false;
  let sessionRef: string | undefined;

  return {
    ...jsonLinesParser((record): CliParsedEvent[] => {
      const events: CliParsedEvent[] = [];
      const recordSession = stringField(record, "sessionId") ?? stringField(record, "session_id");

      if (recordSession !== undefined) {
        sessionRef = recordSession;
      }

      if (!started && recordSession !== undefined) {
        started = true;
        events.push({ type: "session.started", sessionRef: recordSession, raw: record });
      }

      if (stringField(record, "type") === "result") {
        const usage = recordField(record, "usage");

        if (usage !== undefined) {
          events.push({
            type: "usage",
            cumulative: true,
            usage: usageOf({
              input: numberField(usage, "input_tokens"),
              output: numberField(usage, "output_tokens"),
              cachedTokens: numberField(usage, "cache_read_input_tokens") || undefined,
              costUSD: numberField(record, "total_cost_usd"),
            }),
            raw: record,
          });
        }

        const result = stringField(record, "result") ?? "";

        if (record.is_error === true) {
          events.push({
            type: "error",
            message: result || "Reasonix run failed",
            fatal: true,
            raw: record,
          });
        } else if (result.length > 0) {
          events.push({ type: "message", text: result, delta: false, final: true, raw: record });
        }

        return events;
      }

      const tool = asRecord(record.tool);

      switch (stringField(record, "kind")) {
        case "text": {
          const text = stringField(record, "text") ?? "";

          if (text.length > 0) {
            events.push({ type: "message", text, delta: true, raw: record });
          }
          break;
        }
        case "message":
          events.push({
            type: "message",
            text: stringField(record, "text") ?? "",
            delta: false,
            raw: record,
          });
          break;
        case "tool_dispatch":
          // The first dispatch streams arguments (`partial: true`); report the complete one.
          if (tool !== undefined && tool.partial !== true) {
            events.push({
              type: "tool.call",
              id: stringField(tool, "id") ?? "",
              name: stringField(tool, "name") ?? "",
              input: parseArguments(tool.args),
              raw: record,
            });
          }
          break;
        case "tool_result": {
          const error = stringField(tool, "err") ?? "";

          events.push({
            type: "tool.result",
            id: stringField(tool, "id") ?? "",
            output: error.length > 0 ? error : (stringField(tool, "output") ?? ""),
            isError: error.length > 0,
            raw: record,
          });
          break;
        }
        case "usage": {
          const usage = callUsage(recordField(record, "usage"));

          if (usage !== undefined) {
            events.push({ type: "usage", usage, cumulative: false, raw: record });
          }
          break;
        }
        case "turn_done":
          if (stringField(record, "status") === "failed") {
            events.push({
              type: "error",
              message: stringField(record, "err") ?? "Reasonix turn failed",
              fatal: true,
              raw: record,
            });
          }
          break;
      }

      return events;
    }),
    sessionRef: () => sessionRef,
  };
}
