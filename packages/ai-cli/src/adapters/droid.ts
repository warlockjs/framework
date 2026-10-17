import path from "node:path";
import type { CliAdapter, CliLaunchFile, CliParsedEvent, CliStreamParser } from "../contracts";
import { jsonLinesParser, outputText, recordField, stringField } from "../stream/json-lines";
import {
  anthropicUsage,
  argvPrompt,
  jsonFile,
  mcpServersJson,
  promptFile,
  requirePrivateHome,
} from "./shared";

/**
 * Factory Droid (`droid`, npm `droid` / `@factory/cli`).
 *
 * Verified against the real `droid exec --help` of 0.244.0, a real
 * `droid exec` run without credentials (init and error lines), the field
 * names in the shipped code and the docs (`docs.factory.ai/cli/droid-exec`,
 * `/cli/configuration/mcp`), 2026-10-17.
 *
 * - Headless: `droid exec -o stream-json <prompt>` (or `-f <file>`).
 * - Stream: `system/init` (`session_id`, `model`), whole `message` records
 *   (`role`, `text`), `tool_call` (`id`, `toolName`, `parameters`),
 *   `tool_result` (`id`, `isError`, `value` | `error.message`), a final
 *   `completion` (`finalText`, `usage` with Anthropic-style
 *   `input_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`,
 *   read with Anthropic semantics) and `error` (`source`, `message`).
 *   Billing is in Factory credits; no USD cost is reported.
 * - Permissions: `standard` is Droid's default **read-only** autonomy; raise
 *   it with `args: ["--auto", "medium"]` (low | medium | high). Bypass is
 *   `--skip-permissions-unsafe`. Blocked actions end the run non-zero.
 * - MCP: `<home>/.factory/mcp.json` (`mcpServers`); the home is relocated
 *   with `FACTORY_HOME_OVERRIDE` (found in the shipped code and confirmed
 *   with `droid mcp list`), so per-run MCP needs a private home.
 * - Auth: `FACTORY_API_KEY`.
 */
export const droidAdapter: CliAdapter = {
  name: "droid",
  title: "Factory Droid",
  command: "droid",
  apiKeyEnv: ["FACTORY_API_KEY"],
  homeEnv: ["FACTORY_HOME_OVERRIDE"],
  transports: ["argv", "file"],
  effort: true,
  mcp: true,
  probe: { help: [["exec", "--help"]], version: ["--version"] },
  verification: {
    version: "0.244.0",
    verifiedBy: "help",
    sources: [
      "https://docs.factory.ai/cli/droid-exec/overview",
      "https://docs.factory.ai/cli/configuration/mcp",
      "https://www.npmjs.com/package/droid",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["exec", "--output-format", "stream-json", "--cwd", context.cwd];
    const requires = ["--output-format", "stream-json", "--cwd"];
    const files: CliLaunchFile[] = [];
    let tail: string[];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      // Accepted per model from off | none | minimal | low | medium | high | xhigh | max.
      args.push("--reasoning-effort", context.effort);
      requires.push("--reasoning-effort");
    }

    if (context.resume !== undefined) {
      args.push("--session-id", context.resume);
      requires.push("--session-id");
    }

    if (context.permission === "bypass") {
      args.push("--skip-permissions-unsafe");
      requires.push("--skip-permissions-unsafe");
    }

    if (context.mcp !== undefined) {
      const home = requirePrivateHome(context, droidAdapter, "MCP servers");

      files.push({
        path: path.join(home, ".factory", "mcp.json"),
        content: jsonFile({ mcpServers: mcpServersJson(context.mcp, { typeField: true }) }),
      });
    }

    if (context.transport === "file") {
      const prompt = promptFile(context);

      files.push(prompt);
      tail = ["--file", prompt.path];
      requires.push("--file");
    } else {
      tail = [argvPrompt(context.prompt)];
    }

    return {
      args,
      tail,
      env: {
        ...(context.home !== undefined ? { FACTORY_HOME_OVERRIDE: context.home } : {}),
        FACTORY_DROID_AUTO_UPDATE_ENABLED: "false",
      },
      files,
      requires,
    };
  },
  parser: createDroidParser,
};

/** Parser for `droid exec -o stream-json`. */
export function createDroidParser(): CliStreamParser {
  return jsonLinesParser((record): CliParsedEvent[] => {
    switch (stringField(record, "type")) {
      case "system":
        return stringField(record, "subtype") === "init"
          ? [
              {
                type: "session.started",
                sessionRef: stringField(record, "session_id"),
                model: stringField(record, "model"),
                raw: record,
              },
            ]
          : [];
      case "message": {
        const text = stringField(record, "text") ?? "";

        return stringField(record, "role") === "assistant" && text.length > 0
          ? [{ type: "message", text, delta: false, raw: record }]
          : [];
      }
      case "tool_call":
        return [
          {
            type: "tool.call",
            id: stringField(record, "id") ?? "",
            name: stringField(record, "toolName") ?? stringField(record, "toolId") ?? "",
            input: record.parameters,
            raw: record,
          },
        ];
      case "tool_result": {
        const error = recordField(record, "error");
        const isError = record.isError === true || error !== undefined;

        return [
          {
            type: "tool.result",
            id: stringField(record, "id") ?? "",
            output:
              isError && error !== undefined
                ? (stringField(error, "message") ?? "")
                : outputText(record.value),
            isError,
            raw: record,
          },
        ];
      }
      case "completion": {
        const events: CliParsedEvent[] = [];
        const usage = anthropicUsage(recordField(record, "usage"));

        if (usage !== undefined) {
          const thinking = recordField(record, "usage")?.thinking_tokens;

          if (typeof thinking === "number" && thinking > 0) {
            usage.reasoningTokens = thinking;
          }

          events.push({ type: "usage", usage, cumulative: true, raw: record });
        }

        const text = stringField(record, "finalText") ?? "";

        if (text.length > 0) {
          events.push({ type: "message", text, delta: false, final: true, raw: record });
        }

        return events;
      }
      case "error":
        return [
          {
            type: "error",
            message: stringField(record, "message") ?? "Droid reported an error",
            fatal: true,
            raw: record,
          },
        ];
      default:
        return [];
    }
  });
}
