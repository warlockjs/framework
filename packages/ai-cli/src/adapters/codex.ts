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
import { type TomlTable, tomlKey, toToml } from "../utils/toml";
import { argvPrompt, mapEffort, unsupportedOption, usageOf } from "./shared";

/**
 * OpenAI Codex CLI (`codex`, npm `@openai/codex`).
 *
 * Verified against the real `codex exec --help` / `codex exec resume
 * --help` of 0.163.0, the source at tag `rust-v0.163.0` (`exec_events.rs`,
 * the JSONL event processor, `cli.rs`) and the docs (non-interactive mode,
 * config reference), 2026-10-17.
 *
 * - Headless: `codex exec --json --skip-git-repo-check <prompt>` (`-` reads
 *   the prompt from stdin); resume is `codex exec resume … <thread_id>
 *   <prompt>`.
 * - Stream: `thread.started` (`thread_id`), `item.started`/`item.completed`
 *   with `item.type` `agent_message`, `reasoning`, `command_execution`,
 *   `file_change`, `mcp_tool_call`, `web_search`, `error`; `turn.completed`
 *   with the thread's cumulative `usage` (`input_tokens` includes
 *   `cached_input_tokens`); `turn.failed` and `error` on failure. No text
 *   deltas and no cost field.
 * - Permissions: exec never asks (approval policy "never"); `standard` keeps
 *   Codex's default **read-only** sandbox — allow edits with
 *   `args: ["-c", "sandbox_mode=workspace-write"]`. Bypass is
 *   `--dangerously-bypass-approvals-and-sandbox`.
 * - Effort: `-c model_reasoning_effort=<level>`.
 * - MCP: no flag. With a private home the servers go into
 *   `$CODEX_HOME/config.toml` (0600). With a caller-owned or inherited home
 *   they are passed as `-c mcp_servers.<name>.…` overrides that carry only
 *   the command, args and URL; secret `env` values and headers travel in the
 *   process environment, named through `env_vars` / `env_http_headers`.
 * - Home `CODEX_HOME`; auth `CODEX_API_KEY`.
 */
export const codexAdapter: CliAdapter = {
  name: "codex",
  title: "Codex CLI",
  command: "codex",
  apiKeyEnv: ["CODEX_API_KEY"],
  homeEnv: ["CODEX_HOME"],
  transports: ["argv", "stdin"],
  effort: true,
  mcp: true,
  probe: {
    help: [
      ["exec", "--help"],
      ["exec", "resume", "--help"],
    ],
    version: ["--version"],
  },
  verification: {
    version: "0.163.0",
    verifiedBy: "help",
    sources: [
      "https://developers.openai.com/codex/noninteractive",
      "https://developers.openai.com/codex/config-reference",
      "https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/exec/src/exec_events.rs",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["exec"];
    const requires = ["exec", "--json", "--skip-git-repo-check"];
    const files: CliLaunchFile[] = [];
    const env: Record<string, string> = {};

    if (context.resume !== undefined) {
      args.push("resume");
      requires.push("resume");
    }

    args.push("--json", "--skip-git-repo-check", "-c", "check_for_update_on_startup=false");

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      const effort = mapEffort(context.effort, {
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      });

      args.push("-c", `model_reasoning_effort=${effort}`);
      requires.push("--config");
    }

    if (context.permission === "bypass") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
      requires.push("--dangerously-bypass-approvals-and-sandbox");
    }

    if (context.mcp !== undefined) {
      if (context.home !== undefined && context.homeIsPrivate) {
        files.push({
          path: path.join(context.home, "config.toml"),
          content: toToml({ mcp_servers: codexMcpTable(context.mcp) }),
        });
      } else {
        args.push(...codexMcpOverrides(context.mcp, env));
        requires.push("--config");
      }
    }

    if (context.home !== undefined) {
      env.CODEX_HOME = context.home;
    }

    const prompt = context.transport === "argv" ? argvPrompt(context.prompt) : "-";

    return {
      args,
      tail: context.resume !== undefined ? [context.resume, prompt] : [prompt],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env,
      files,
      requires,
    };
  },
  parser: createCodexParser,
};

/** `[mcp_servers.<name>]` tables for a private `config.toml`. */
function codexMcpTable(servers: CliMcpServers): TomlTable {
  const table: TomlTable = {};

  for (const [name, server] of Object.entries(servers)) {
    if (server.type === "sse") {
      throw unsupportedOption(
        codexAdapter,
        `MCP server "${name}" uses SSE; Codex supports stdio and streamable HTTP.`,
      );
    }

    table[name] =
      server.type === "stdio"
        ? { command: server.command, args: server.args ?? [], env: server.env }
        : { url: server.url, http_headers: server.headers };
  }

  return table;
}

/** A TOML string for a `-c key=value` override. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * `-c` overrides that carry no secret: env values and header values are put
 * in `env` (the Codex process environment) and only their names go to argv.
 */
function codexMcpOverrides(servers: CliMcpServers, env: Record<string, string>): string[] {
  const overrides: string[] = [];
  const claim = (name: string, value: string): void => {
    if (env[name] !== undefined && env[name] !== value) {
      throw unsupportedOption(
        codexAdapter,
        `two MCP servers set ${name} to different values; with a shared home they share one environment.`,
      );
    }

    env[name] = value;
  };

  for (const [name, server] of Object.entries(servers)) {
    const prefix = `mcp_servers.${tomlKey(name)}`;

    if (server.type === "sse") {
      throw unsupportedOption(
        codexAdapter,
        `MCP server "${name}" uses SSE; Codex supports stdio and streamable HTTP.`,
      );
    }

    if (server.type === "stdio") {
      overrides.push("-c", `${prefix}.command=${tomlString(server.command)}`);
      overrides.push("-c", `${prefix}.args=[${(server.args ?? []).map(tomlString).join(",")}]`);

      const names = Object.keys(server.env ?? {});

      for (const [key, value] of Object.entries(server.env ?? {})) {
        claim(key, value);
      }

      if (names.length > 0) {
        overrides.push("-c", `${prefix}.env_vars=[${names.map(tomlString).join(",")}]`);
      }

      continue;
    }

    overrides.push("-c", `${prefix}.url=${tomlString(server.url)}`);

    const headers = Object.entries(server.headers ?? {});

    if (headers.length > 0) {
      const mapping = headers.map(([header, value], index) => {
        const variable = `WARLOCK_MCP_${name.replace(/\W/g, "_").toUpperCase()}_HEADER_${index}`;

        claim(variable, value);

        return `${tomlString(header)}=${tomlString(variable)}`;
      });

      overrides.push("-c", `${prefix}.env_http_headers={${mapping.join(",")}}`);
    }
  }

  return overrides;
}

const TOOL_ITEMS = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "collab_tool_call",
]);

function toolCall(item: Record<string, unknown>): { name: string; input: unknown } {
  switch (stringField(item, "type")) {
    case "command_execution":
      return { name: "shell", input: { command: item.command } };
    case "file_change":
      return { name: "apply_patch", input: { changes: item.changes } };
    case "mcp_tool_call":
      return {
        name: `${stringField(item, "server") ?? "mcp"}.${stringField(item, "tool") ?? "tool"}`,
        input: item.arguments,
      };
    case "web_search":
      return { name: "web_search", input: { query: item.query } };
    default:
      return { name: stringField(item, "type") ?? "tool", input: item };
  }
}

function toolResult(item: Record<string, unknown>): { output: string; isError: boolean } {
  const status = stringField(item, "status");
  const failed = status === "failed" || status === "declined";

  switch (stringField(item, "type")) {
    case "command_execution": {
      const exitCode = numberField(item, "exit_code");

      return {
        output: stringField(item, "aggregated_output") ?? "",
        isError: failed || (exitCode !== undefined && exitCode !== 0),
      };
    }
    case "mcp_tool_call": {
      const error = stringField(recordField(item, "error"), "message");

      return error !== undefined
        ? { output: error, isError: true }
        : { output: outputText(recordField(item, "result")?.content), isError: failed };
    }
    default:
      return { output: outputText(item.changes ?? item.result ?? ""), isError: failed };
  }
}

/** Parser for `codex exec --json`. */
export function createCodexParser(): CliStreamParser {
  const announced = new Set<string>();

  return jsonLinesParser((record): CliParsedEvent[] => {
    const type = stringField(record, "type");
    const item = recordField(record, "item");
    const itemType = stringField(item, "type");
    const id = stringField(item, "id") ?? "";

    if (type === "thread.started") {
      return [
        { type: "session.started", sessionRef: stringField(record, "thread_id"), raw: record },
      ];
    }

    if (
      type === "item.started" &&
      item !== undefined &&
      itemType !== undefined &&
      TOOL_ITEMS.has(itemType)
    ) {
      announced.add(id);

      return [{ type: "tool.call", id, ...toolCall(item), raw: record }];
    }

    if (type === "item.completed" && item !== undefined) {
      if (itemType === "agent_message") {
        const text = stringField(item, "text") ?? "";

        return text.length > 0 ? [{ type: "message", text, delta: false, raw: record }] : [];
      }

      if (itemType === "error") {
        return [{ type: "error", message: stringField(item, "message") ?? "error", raw: record }];
      }

      if (itemType !== undefined && TOOL_ITEMS.has(itemType)) {
        const events: CliParsedEvent[] = [];

        if (!announced.has(id)) {
          events.push({ type: "tool.call", id, ...toolCall(item), raw: record });
        }

        events.push({ type: "tool.result", id, ...toolResult(item), raw: record });

        return events;
      }

      return [];
    }

    if (type === "turn.completed") {
      const usage = recordField(record, "usage");

      if (usage === undefined) {
        return [];
      }

      const cached = numberField(usage, "cached_input_tokens");
      const written = numberField(usage, "cache_write_input_tokens");

      return [
        {
          type: "usage",
          cumulative: true,
          usage: usageOf({
            input: numberField(usage, "input_tokens"),
            output: numberField(usage, "output_tokens"),
            cachedTokens: cached !== undefined && cached > 0 ? cached : undefined,
            cacheWriteTokens: written !== undefined && written > 0 ? written : undefined,
            reasoningTokens: numberField(usage, "reasoning_output_tokens") || undefined,
          }),
          raw: record,
        },
      ];
    }

    if (type === "turn.failed") {
      return [
        {
          type: "error",
          message: stringField(recordField(record, "error"), "message") ?? "Codex turn failed",
          fatal: true,
          raw: record,
        },
      ];
    }

    if (type === "error") {
      return [
        {
          type: "error",
          message: stringField(record, "message") ?? "Codex error",
          fatal: true,
          raw: record,
        },
      ];
    }

    return [];
  });
}
