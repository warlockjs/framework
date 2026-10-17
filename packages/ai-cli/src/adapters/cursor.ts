import path from "node:path";
import type { CliAdapter, CliLaunchFile, CliParsedEvent, CliStreamParser } from "../contracts";
import {
  asArray,
  asRecord,
  jsonLinesParser,
  numberField,
  outputText,
  recordField,
  stringField,
} from "../stream/json-lines";
import {
  argvPrompt,
  jsonFile,
  mcpServersJson,
  parseArguments,
  requirePrivateHome,
  usageOf,
} from "./shared";

/**
 * Cursor CLI (`cursor-agent`, also installed as `agent`), installed by the
 * `cursor.com/install` script (no official npm package).
 *
 * Verified against the official docs (`cursor.com/docs/cli/{headless,mcp}`,
 * `/docs/cli/reference/{output-format,parameters,authentication,
 * permissions,configuration}`) and the option strings of the
 * 2026.10.16-e3cb207 release bundle (read, not executed), 2026-10-17. The
 * capability probe checks every flag against the installed `--help`.
 *
 * - Headless: `cursor-agent -p --output-format stream-json --trust <prompt>`;
 *   with no positional prompt, stdin is the prompt. `--trust` is passed
 *   because print mode exits in a directory that was never trusted — the
 *   run's `cwd` is the caller's explicit choice.
 * - Stream: `system/init` (`session_id`, `model`), `user` echo, `assistant`
 *   messages (`message.content[].text`), `tool_call` `started`/`completed`
 *   (`call_id`; the tool is the single key of `tool_call`, e.g.
 *   `readToolCall{args,result{success}}`), and a final `result` with
 *   `usage{inputTokens (net of cache), outputTokens, cacheReadTokens,
 *   cacheWriteTokens}`. Errors are not JSON: stderr and a non-zero exit.
 * - Permissions: headless default is the allowlist mode (unlisted actions are
 *   rejected, changes only proposed); bypass is `--force`.
 * - MCP: no flag; `$HOME/.cursor/mcp.json` (the path ignores
 *   `CURSOR_CONFIG_DIR`), plus `--approve-mcps` — needs a private home.
 * - Home: `HOME`/`USERPROFILE`, `CURSOR_CONFIG_DIR` and `CURSOR_DATA_DIR`
 *   are pointed into it. Auth: `CURSOR_API_KEY`.
 */
export const cursorAdapter: CliAdapter = {
  name: "cursor",
  title: "Cursor CLI",
  command: "cursor-agent",
  apiKeyEnv: ["CURSOR_API_KEY"],
  homeEnv: ["HOME", "USERPROFILE", "CURSOR_CONFIG_DIR", "CURSOR_DATA_DIR"],
  transports: ["argv", "stdin"],
  effort: false,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "2026.10.16-e3cb207",
    verifiedBy: "docs",
    sources: [
      "https://cursor.com/docs/cli/headless",
      "https://cursor.com/docs/cli/reference/output-format",
      "https://cursor.com/docs/cli/reference/parameters",
      "https://cursor.com/docs/cli/mcp",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["--print", "--output-format", "stream-json", "--trust"];
    const requires = ["--print", "--output-format", "stream-json", "--trust"];
    const files: CliLaunchFile[] = [];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.resume !== undefined) {
      args.push("--resume", context.resume);
      requires.push("--resume");
    }

    if (context.permission === "bypass") {
      args.push("--force");
      requires.push("--force");
    }

    if (context.mcp !== undefined) {
      const home = requirePrivateHome(context, cursorAdapter, "MCP servers");

      files.push({
        path: path.join(home, ".cursor", "mcp.json"),
        content: jsonFile({ mcpServers: mcpServersJson(context.mcp, { typeField: true }) }),
      });
      args.push("--approve-mcps");
      requires.push("--approve-mcps");
    }

    const env: Record<string, string> =
      context.home !== undefined
        ? {
            HOME: context.home,
            USERPROFILE: context.home,
            CURSOR_CONFIG_DIR: path.join(context.home, ".cursor"),
            CURSOR_DATA_DIR: path.join(context.home, ".cursor"),
          }
        : {};

    return {
      args,
      tail: context.transport === "argv" ? [argvPrompt(context.prompt)] : [],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env,
      files,
      requires,
    };
  },
  parser: createCursorParser,
};

/** `readToolCall` → `read`; the documented `function{name}` fallback is used as-is. */
function toolOf(toolCall: Record<string, unknown> | undefined): {
  name: string;
  body: Record<string, unknown> | undefined;
} {
  const fn = recordField(toolCall, "function");

  if (fn !== undefined) {
    return { name: stringField(fn, "name") ?? "function", body: fn };
  }

  const key = Object.keys(toolCall ?? {})[0] ?? "tool";

  return { name: key.replace(/ToolCall$/, ""), body: recordField(toolCall, key) };
}

/** Parser for `cursor-agent -p --output-format stream-json`. */
export function createCursorParser(): CliStreamParser {
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
      case "assistant": {
        const text = asArray(recordField(record, "message")?.content)
          .map((block) => stringField(asRecord(block), "text") ?? "")
          .join("");

        return text.length > 0 ? [{ type: "message", text, delta: false, raw: record }] : [];
      }
      case "tool_call": {
        const id = stringField(record, "call_id") ?? "";
        const { name, body } = toolOf(recordField(record, "tool_call"));

        if (stringField(record, "subtype") === "started") {
          return [
            {
              type: "tool.call",
              id,
              name,
              input: body?.args ?? parseArguments(body?.arguments),
              raw: record,
            },
          ];
        }

        if (stringField(record, "subtype") === "completed") {
          const result = recordField(body, "result");
          const success = recordField(result, "success");
          const content = stringField(success, "content");

          return [
            {
              type: "tool.result",
              id,
              output: success !== undefined ? (content ?? outputText(success)) : outputText(result),
              isError: success === undefined,
              raw: record,
            },
          ];
        }

        return [];
      }
      case "result": {
        const events: CliParsedEvent[] = [];
        const usage = recordField(record, "usage");

        if (usage !== undefined) {
          const cacheRead = numberField(usage, "cacheReadTokens") ?? 0;
          const cacheWrite = numberField(usage, "cacheWriteTokens") ?? 0;

          events.push({
            type: "usage",
            cumulative: true,
            usage: usageOf({
              input: (numberField(usage, "inputTokens") ?? 0) + cacheRead + cacheWrite,
              output: numberField(usage, "outputTokens"),
              cachedTokens: cacheRead > 0 ? cacheRead : undefined,
              cacheWriteTokens: cacheWrite > 0 ? cacheWrite : undefined,
            }),
            raw: record,
          });
        }

        if (record.is_error === true) {
          events.push({
            type: "error",
            message: stringField(record, "result") || "Cursor CLI reported an error",
            fatal: true,
            raw: record,
          });
        }

        // `result` concatenates every assistant message, so the final answer
        // is taken from the last assistant message instead.
        return events;
      }
      default:
        return [];
    }
  });
}
