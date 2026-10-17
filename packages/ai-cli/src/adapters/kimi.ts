import path from "node:path";
import type {
  CliAdapter,
  CliLaunchFile,
  CliMcpServers,
  CliParsedEvent,
  CliStreamParser,
} from "../contracts";
import { asArray, asRecord, jsonLinesParser, outputText, stringField } from "../stream/json-lines";
import {
  argvPrompt,
  jsonFile,
  mcpServersJson,
  parseArguments,
  requirePrivateHome,
  unsupportedOption,
} from "./shared";

/**
 * Kimi Code CLI (`kimi`, npm `@moonshot-ai/kimi-code`) — Moonshot AI's
 * coding agent, the successor of the archived Python `kimi-cli`.
 *
 * Verified against the real `kimi --help` of 2.2.0 and the docs/source at
 * that tag (`docs/en/reference/kimi-command.md`, `apps/kimi-code/src/cli/
 * {options.ts,prompt-render.ts,v2/run-v2-print.ts}`), 2026-10-17.
 *
 * - Headless: `kimi -p <prompt> --output-format stream-json`; the prompt is
 *   an argv value only (print mode never reads stdin).
 * - Stream: OpenAI-chat-shaped messages, one per line, never deltas:
 *   `{"role":"assistant","content","tool_calls"}`, `{"role":"tool",
 *   "tool_call_id","content"}`, and `{"role":"meta","type":…}` records. The
 *   session id appears only in the final `session.resume_hint` record.
 *   No token usage is printed.
 * - Permissions: print mode always runs in "Never Ask" mode (every tool call
 *   runs; only static deny rules apply) and rejects `--yolo`/`--plan`, so
 *   there is no standard mode to choose. The adapter refuses
 *   `permission: "standard"` instead of pretending to enforce it; pass
 *   `"bypass"` to accept the CLI's behaviour.
 * - MCP: no flag; `$KIMI_CODE_HOME/mcp.json` (`mcpServers`), so per-run MCP
 *   needs a private home.
 * - Auth: shell `KIMI_API_KEY`/`MOONSHOT_API_KEY` are not read. For an API
 *   key set `KIMI_MODEL_NAME` (and optionally `KIMI_MODEL_PROVIDER_TYPE`,
 *   `KIMI_MODEL_BASE_URL`) in `env`; `apiKey` becomes `KIMI_MODEL_API_KEY`.
 */
export const kimiAdapter: CliAdapter = {
  name: "kimi",
  title: "Kimi Code",
  command: "kimi",
  apiKeyEnv: ["KIMI_MODEL_API_KEY"],
  homeEnv: ["KIMI_CODE_HOME"],
  transports: ["argv"],
  effort: false,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "2.2.0",
    verifiedBy: "help",
    sources: [
      "https://moonshotai.github.io/kimi-code/",
      "https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.2.0/docs/en/reference/kimi-command.md",
      "https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.2.0/docs/en/customization/mcp.md",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    if (context.permission !== "bypass") {
      throw unsupportedOption(
        kimiAdapter,
        'print mode runs every tool call without asking and has no standard approval mode; pass `permission: "bypass"` to run it.',
      );
    }

    const args = ["--output-format", "stream-json"];
    const requires = ["-p", "--output-format", "stream-json"];
    const files: CliLaunchFile[] = [];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.resume !== undefined) {
      args.push("--session", context.resume);
      requires.push("--session");
    }

    if (context.mcp !== undefined) {
      const home = requirePrivateHome(context, kimiAdapter, "MCP servers");

      files.push({
        path: path.join(home, "mcp.json"),
        content: jsonFile({ mcpServers: kimiMcp(context.mcp) }),
      });
    }

    return {
      args,
      tail: ["-p", argvPrompt(context.prompt)],
      env: {
        ...(context.home !== undefined ? { KIMI_CODE_HOME: context.home } : {}),
        KIMI_CODE_NO_AUTO_UPDATE: "1",
        KIMI_DISABLE_TELEMETRY: "1",
      },
      files,
      requires,
    };
  },
  parser: createKimiParser,
};

/** Kimi's `mcpServers`: SSE servers are marked with `transport: "sse"`. */
function kimiMcp(servers: CliMcpServers): Record<string, unknown> {
  const rendered = mcpServersJson(servers);

  for (const [name, server] of Object.entries(servers)) {
    const entry = rendered[name];

    if (server.type === "sse" && entry !== undefined) {
      entry.transport = "sse";
    }
  }

  return rendered;
}

/** Parser for `kimi -p … --output-format stream-json`. */
export function createKimiParser(): CliStreamParser {
  let sessionRef: string | undefined;

  const parser = jsonLinesParser((record): CliParsedEvent[] => {
    const role = stringField(record, "role");

    if (role === "meta") {
      const type = stringField(record, "type");

      if (type === "system.version") {
        return [{ type: "session.started", raw: record }];
      }

      if (type === "session.resume_hint") {
        sessionRef = stringField(record, "session_id");

        return [];
      }

      if (type === "turn.step.retrying") {
        return [
          {
            type: "error",
            message: `retrying after ${stringField(record, "error_name") ?? "error"}: ${stringField(record, "error_message") ?? ""}`,
            raw: record,
          },
        ];
      }

      return [];
    }

    if (role === "assistant") {
      const events: CliParsedEvent[] = [];
      const content = stringField(record, "content");

      if (content !== undefined && content.length > 0) {
        events.push({ type: "message", text: content, delta: false, raw: record });
      }

      for (const item of asArray(record.tool_calls)) {
        const call = asRecord(item);
        const fn = asRecord(call?.function);

        events.push({
          type: "tool.call",
          id: stringField(call, "id") ?? "",
          name: stringField(fn, "name") ?? "",
          input: parseArguments(fn?.arguments),
          raw: item,
        });
      }

      return events;
    }

    if (role === "tool") {
      return [
        {
          type: "tool.result",
          id: stringField(record, "tool_call_id") ?? "",
          output: outputText(record.content),
          isError: false,
          raw: record,
        },
      ];
    }

    return [];
  });

  return { ...parser, sessionRef: () => sessionRef };
}
