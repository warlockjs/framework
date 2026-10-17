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
  outputText,
  recordField,
  stringField,
} from "../stream/json-lines";
import { type TomlTable, toToml } from "../utils/toml";
import {
  anthropicUsage,
  argvPrompt,
  promptFile,
  requirePrivateHome,
  unsupportedOption,
} from "./shared";

/**
 * Grok Build (`grok`) — xAI's official coding-agent CLI, installed by the
 * `x.ai/cli/install.sh` script (no npm package).
 *
 * Verified against the docs and source only (the binary is distributed by
 * a curl installer, which was not run): the repo user guide
 * `crates/codegen/xai-grok-pager/docs/user-guide/{14-headless-mode,
 * 07-mcp-servers,05-configuration,22-permissions-and-safety}.md`, the clap
 * definitions in `xai-grok-pager/src/app/cli.rs` and the headless reducer
 * `headless/reducer/acp.rs`, at source version 1.0.45; latest stable 1.0.62
 * (2026-10-17). The capability probe checks every flag against the
 * installed binary's `--help` before the first run.
 *
 * - Headless: `grok -p <prompt>` or `--prompt-file <path>`; piped stdin is
 *   not read. `--output-format streaming-json` prints `type`-tagged lines:
 *   `text`, `thought`, `tool_call`, `tool_call_update`, `usage` (per model
 *   response, `input_tokens` uncached) and a final `end` (session id, totals,
 *   `total_cost_usd`); failures print `{"type":"error","message"}`.
 * - Permissions: headless mode answers every approval request with
 *   "cancelled" (auto-deny); bypass is `--always-approve`.
 * - MCP: no flag; `[mcp_servers.<name>]` in `$GROK_HOME/config.toml`.
 * - Auth: `XAI_API_KEY`. Update checks are disabled with
 *   `GROK_DISABLE_AUTOUPDATER=1`.
 */
export const grokAdapter: CliAdapter = {
  name: "grok",
  title: "Grok Build",
  command: "grok",
  apiKeyEnv: ["XAI_API_KEY"],
  homeEnv: ["GROK_HOME"],
  transports: ["argv", "file"],
  effort: true,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "1.0.62",
    verifiedBy: "docs",
    sources: [
      "https://docs.x.ai/build/cli/headless-scripting",
      "https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md",
      "https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/07-mcp-servers.md",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["--output-format", "streaming-json"];
    const requires = ["--output-format", "streaming-json"];
    const files: CliLaunchFile[] = [];
    let tail: string[];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      // Grok accepts the framework scale verbatim (none … max, model-dependent).
      args.push("--reasoning-effort", context.effort);
      requires.push("--reasoning-effort");
    }

    if (context.resume !== undefined) {
      args.push("--resume", context.resume);
      requires.push("--resume");
    }

    if (context.permission === "bypass") {
      args.push("--always-approve");
      requires.push("--always-approve");
    }

    if (context.mcp !== undefined) {
      const home = requirePrivateHome(context, grokAdapter, "MCP servers");

      files.push({
        path: path.join(home, "config.toml"),
        content: toToml({ mcp_servers: grokMcp(context.mcp) }),
      });
    }

    if (context.transport === "file") {
      const prompt = promptFile(context);

      files.push(prompt);
      tail = ["--prompt-file", prompt.path];
      requires.push("--prompt-file");
    } else {
      tail = ["-p", argvPrompt(context.prompt)];
      requires.push("-p");
    }

    return {
      args,
      tail,
      env: {
        ...(context.home !== undefined ? { GROK_HOME: context.home } : {}),
        GROK_DISABLE_AUTOUPDATER: "1",
      },
      files,
      requires,
    };
  },
  parser: createGrokParser,
};

function grokMcp(servers: CliMcpServers): TomlTable {
  const table: TomlTable = {};

  for (const [name, server] of Object.entries(servers)) {
    if (server.type === "sse") {
      throw unsupportedOption(
        grokAdapter,
        `MCP server "${name}" uses SSE; Grok Build supports stdio and HTTP servers.`,
      );
    }

    table[name] =
      server.type === "stdio"
        ? { command: server.command, args: server.args ?? [], env: server.env }
        : { url: server.url, headers: server.headers };
  }

  return table;
}

/** Parser for `grok -p … --output-format streaming-json`. */
export function createGrokParser(): CliStreamParser {
  let started = false;
  let sessionRef: string | undefined;

  const parser = jsonLinesParser((record): CliParsedEvent[] => {
    const events: CliParsedEvent[] = [];

    if (!started) {
      started = true;
      events.push({ type: "session.started" });
    }

    switch (stringField(record, "type")) {
      case "text": {
        const text = stringField(record, "data") ?? "";

        if (text.length > 0) {
          events.push({ type: "message", text, delta: true, raw: record });
        }
        break;
      }
      case "tool_call":
        events.push({
          type: "tool.call",
          id: stringField(record, "toolCallId") ?? "",
          name: stringField(record, "toolName") ?? stringField(record, "title") ?? "",
          input: record.rawInput,
          raw: record,
        });
        break;
      case "tool_call_update": {
        const status = stringField(record, "status");

        if (status === "completed" || status === "failed") {
          events.push({
            type: "tool.result",
            id: stringField(record, "toolCallId") ?? "",
            output: outputText(record.rawOutput ?? record.content),
            isError: status === "failed",
            raw: record,
          });
        }
        break;
      }
      case "usage": {
        const usage = anthropicUsage(recordField(record, "usage"));

        if (usage !== undefined) {
          events.push({ type: "usage", usage, cumulative: false, raw: record });
        }
        break;
      }
      case "end": {
        sessionRef = stringField(record, "sessionId") ?? sessionRef;

        const usage = anthropicUsage(
          recordField(record, "usage"),
          numberField(record, "total_cost_usd"),
        );

        if (usage !== undefined) {
          events.push({ type: "usage", usage, cumulative: true, raw: record });
        }
        break;
      }
      case "error":
        events.push({
          type: "error",
          message: stringField(record, "message") ?? "Grok Build reported an error",
          fatal: true,
          raw: record,
        });
        break;
    }

    return events;
  });

  return { ...parser, sessionRef: () => sessionRef };
}
