import path from "node:path";
import type {
  CliAdapter,
  CliLaunchFile,
  CliMcpServers,
  CliParsedEvent,
  CliStreamParser,
} from "../contracts";
import {
  asRecord,
  jsonLinesParser,
  numberField,
  recordField,
  stringField,
} from "../stream/json-lines";
import { argvPrompt, jsonFile, usageOf } from "./shared";

/**
 * OpenCode (`opencode`, npm `opencode-ai`).
 *
 * Verified against the real `opencode --help` / `opencode run --help` of
 * 1.19.3, the CLI source at that tag (`packages/opencode/src/cli/cmd/run.ts`)
 * and the docs (`cli.mdx`, `config.mdx`, `mcp-servers.mdx`,
 * `permissions.mdx`), 2026-10-17.
 *
 * - Headless: `opencode run --format json <message..>`; with no message,
 *   piped stdin is the prompt.
 * - Stream: `{"type","timestamp","sessionID","part"|"error"}` lines of six
 *   types: `step_start`, `text` (whole text blocks, no deltas), `reasoning`,
 *   `tool_use` (emitted once the tool finished — call and result together,
 *   `state.status` `completed`/`error`), `step_finish` (per-step `cost` in
 *   USD and `tokens{input,output,reasoning,cache{read,write}}`, input net of
 *   cache) and `error{error:{name,data:{message}}}`. No init or final record.
 * - Permissions: `standard` keeps OpenCode's own rules (permissive by
 *   default; anything that would ask is auto-rejected in `run`); bypass is
 *   `--auto`.
 * - MCP: the `mcp` key of a config file named by `OPENCODE_CONFIG`, written
 *   to the run directory — works with any home.
 * - Home: OpenCode follows XDG; a private/owned home sets `XDG_CONFIG_HOME`,
 *   `XDG_DATA_HOME` (auth lives here), `XDG_STATE_HOME` and `XDG_CACHE_HOME`
 *   beneath it. Provider keys use the provider's own variable
 *   (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) — pass them through `env`.
 * - The working directory is passed with `--dir`, because OpenCode prefers a
 *   (possibly stale) `PWD` over the process cwd.
 */
export const opencodeAdapter: CliAdapter = {
  name: "opencode",
  title: "OpenCode",
  command: "opencode",
  apiKeyEnv: [],
  homeEnv: ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"],
  transports: ["argv", "stdin"],
  effort: true,
  mcp: true,
  probe: { help: [["run", "--help"]], version: ["--version"] },
  verification: {
    version: "1.19.3",
    verifiedBy: "help",
    sources: [
      "https://opencode.ai/docs/cli/",
      "https://opencode.ai/docs/mcp-servers/",
      "https://opencode.ai/docs/permissions/",
      "https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/cli/cmd/run.ts",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["run", "--format", "json", "--dir", context.cwd];
    const requires = ["--format", "--dir"];
    const files: CliLaunchFile[] = [];
    const env: Record<string, string> = { OPENCODE_DISABLE_AUTOUPDATE: "1" };

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      // `--variant` is provider-specific ("high, max, minimal"); the level is passed as-is.
      args.push("--variant", context.effort);
      requires.push("--variant");
    }

    if (context.resume !== undefined) {
      args.push("--session", context.resume);
      requires.push("--session");
    }

    if (context.permission === "bypass") {
      args.push("--auto");
      requires.push("--auto");
    }

    if (context.mcp !== undefined) {
      const file = path.join(context.runDir, "opencode.json");

      files.push({
        path: file,
        content: jsonFile({
          $schema: "https://opencode.ai/config.json",
          mcp: opencodeMcp(context.mcp),
        }),
      });
      env.OPENCODE_CONFIG = file;
    }

    if (context.home !== undefined) {
      env.XDG_CONFIG_HOME = path.join(context.home, "config");
      env.XDG_DATA_HOME = path.join(context.home, "data");
      env.XDG_STATE_HOME = path.join(context.home, "state");
      env.XDG_CACHE_HOME = path.join(context.home, "cache");
    }

    return {
      args,
      tail: context.transport === "argv" ? [argvPrompt(context.prompt)] : [],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env,
      files,
      requires,
    };
  },
  parser: createOpencodeParser,
};

function opencodeMcp(servers: CliMcpServers): Record<string, unknown> {
  const rendered: Record<string, unknown> = {};

  for (const [name, server] of Object.entries(servers)) {
    rendered[name] =
      server.type === "stdio"
        ? {
            type: "local",
            command: [server.command, ...(server.args ?? [])],
            ...(server.env !== undefined ? { environment: server.env } : {}),
            enabled: true,
          }
        : {
            type: "remote",
            url: server.url,
            ...(server.headers !== undefined ? { headers: server.headers } : {}),
            enabled: true,
          };
  }

  return rendered;
}

/** Parser for `opencode run --format json`. */
export function createOpencodeParser(): CliStreamParser {
  let started = false;

  return jsonLinesParser((record): CliParsedEvent[] => {
    const events: CliParsedEvent[] = [];
    const part = recordField(record, "part");

    if (!started) {
      started = true;
      events.push({
        type: "session.started",
        sessionRef: stringField(record, "sessionID"),
        raw: record,
      });
    }

    switch (stringField(record, "type")) {
      case "text": {
        const text = stringField(part, "text") ?? "";

        if (text.length > 0) {
          events.push({ type: "message", text, delta: false, raw: record });
        }
        break;
      }
      case "tool_use": {
        const state = recordField(part, "state");
        const id = stringField(part, "callID") ?? stringField(part, "id") ?? "";
        const failed = stringField(state, "status") === "error";

        events.push(
          {
            type: "tool.call",
            id,
            name: stringField(part, "tool") ?? "",
            input: state?.input,
            raw: record,
          },
          {
            type: "tool.result",
            id,
            output: (failed ? stringField(state, "error") : stringField(state, "output")) ?? "",
            isError: failed,
            raw: record,
          },
        );
        break;
      }
      case "step_finish": {
        const tokens = recordField(part, "tokens");
        const cache = recordField(tokens, "cache");

        if (tokens !== undefined) {
          const uncached = numberField(tokens, "input") ?? 0;
          const cacheRead = numberField(cache, "read") ?? 0;
          const cacheWrite = numberField(cache, "write") ?? 0;

          events.push({
            type: "usage",
            cumulative: false,
            usage: usageOf({
              input: uncached + cacheRead + cacheWrite,
              output: numberField(tokens, "output"),
              cachedTokens: cacheRead > 0 ? cacheRead : undefined,
              cacheWriteTokens: cacheWrite > 0 ? cacheWrite : undefined,
              reasoningTokens: numberField(tokens, "reasoning") || undefined,
              costUSD: numberField(part, "cost"),
            }),
            raw: record,
          });
        }
        break;
      }
      case "error": {
        const error = asRecord(record.error);
        const name = stringField(error, "name") ?? "Error";
        const message = stringField(recordField(error, "data"), "message") ?? name;

        events.push({ type: "error", message: `${name}: ${message}`, fatal: true, raw: record });
        break;
      }
    }

    return events;
  });
}
