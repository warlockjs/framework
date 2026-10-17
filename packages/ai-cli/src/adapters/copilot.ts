import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  CliAdapter,
  CliLaunchContext,
  CliLaunchFile,
  CliParsedEvent,
  CliStreamParser,
} from "../contracts";
import {
  asRecord,
  jsonLinesParser,
  numberField,
  outputText,
  parseJsonLine,
  recordField,
  stringField,
} from "../stream/json-lines";
import { argvPrompt, jsonFile, mcpServersJson, usageOf } from "./shared";

/** Usage file (inside the run directory) Copilot writes on exit. */
const USAGE_FILE = "copilot-usage.json";

/**
 * GitHub Copilot CLI (`copilot`, npm `@github/copilot`).
 *
 * Verified against the real `copilot --help` of 1.0.98, the JSONL writer in
 * the shipped CLI, the event types of `@github/copilot-sdk` 1.0.22 and the
 * docs (`docs.github.com/copilot/how-tos/copilot-cli/…`, programmatic and
 * command references), 2026-10-17.
 *
 * - Headless: `copilot -p <prompt> --output-format json --stream on`
 *   (piped stdin is the prompt when `-p` is absent). Stream lines are
 *   session events `{type,data,id,timestamp}`: `assistant.message_delta`
 *   (`deltaContent`), `assistant.message` (`content`),
 *   `tool.execution_start` (`toolCallId`, `toolName`, `arguments`),
 *   `tool.execution_complete` (`success`, `result.content`,
 *   `error.message`), `session.error`, and a final CLI-built `result`
 *   (`sessionId`, `exitCode`, premium-request usage).
 * - Tokens are not in the stream; the adapter passes `--usage-output-file`
 *   and reads `modelMetrics.*.usage` from it when the stream ends. Billing
 *   is in premium requests, so no USD cost is reported.
 * - Permissions: unapproved tool requests are auto-denied in `-p` mode;
 *   bypass is `--allow-all` (tools, paths and URLs). `--no-ask-user` and
 *   `--no-auto-update` are always passed.
 * - MCP: `--additional-mcp-config @<file>` (`mcpServers`, `type`
 *   `local`/`http`/`sse`, `tools: ["*"]`), written to the run directory.
 * - Home `COPILOT_HOME`; auth `COPILOT_GITHUB_TOKEN`. Resume with
 *   `--session-id <id>`.
 */
export const copilotAdapter: CliAdapter = {
  name: "copilot",
  title: "Copilot CLI",
  command: "copilot",
  apiKeyEnv: ["COPILOT_GITHUB_TOKEN"],
  homeEnv: ["COPILOT_HOME"],
  transports: ["argv", "stdin"],
  effort: true,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "1.0.98",
    verifiedBy: "help",
    sources: [
      "https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically",
      "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference",
      "https://www.npmjs.com/package/@github/copilot",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = [
      "--output-format",
      "json",
      "--stream",
      "on",
      "--no-ask-user",
      "--no-auto-update",
      "--usage-output-file",
      path.join(context.runDir, USAGE_FILE),
    ];
    const requires = [
      "--output-format",
      "--stream",
      "--no-ask-user",
      "--no-auto-update",
      "--usage-output-file",
    ];
    const files: CliLaunchFile[] = [];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      // Copilot accepts the framework scale verbatim: none … max.
      args.push("--reasoning-effort", context.effort);
      requires.push("--reasoning-effort");
    }

    if (context.resume !== undefined) {
      args.push("--session-id", context.resume);
      requires.push("--session-id");
    }

    if (context.permission === "bypass") {
      args.push("--allow-all");
      requires.push("--allow-all");
    }

    if (context.mcp !== undefined) {
      const file = path.join(context.runDir, "copilot-mcp.json");
      const servers = mcpServersJson(context.mcp, { typeField: true, extra: { tools: ["*"] } });

      for (const server of Object.values(servers)) {
        if (server.type === "stdio") {
          server.type = "local";
        }
      }

      files.push({ path: file, content: jsonFile({ mcpServers: servers }) });
      args.push("--additional-mcp-config", `@${file}`);
      requires.push("--additional-mcp-config");
    }

    return {
      args,
      tail: context.transport === "argv" ? ["-p", argvPrompt(context.prompt)] : [],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env: context.home !== undefined ? { COPILOT_HOME: context.home } : undefined,
      files,
      requires: context.transport === "argv" ? [...requires, "-p"] : requires,
    };
  },
  parser: createCopilotParser,
};

/** Token usage summed over `modelMetrics` of the usage file. */
function usageFileEvent(context: CliLaunchContext | undefined): CliParsedEvent | undefined {
  if (context === undefined) {
    return undefined;
  }

  let report: Record<string, unknown> | undefined;

  try {
    report = parseJsonLine(readFileSync(path.join(context.runDir, USAGE_FILE), "utf8"));
  } catch {
    return undefined;
  }

  const metrics = recordField(report, "modelMetrics");

  if (metrics === undefined) {
    return undefined;
  }

  let input = 0;
  let output = 0;
  let cached = 0;
  let written = 0;
  let reasoning = 0;

  for (const value of Object.values(metrics)) {
    const usage = recordField(asRecord(value), "usage");

    input += numberField(usage, "inputTokens") ?? 0;
    output += numberField(usage, "outputTokens") ?? 0;
    cached += numberField(usage, "cacheReadTokens") ?? 0;
    written += numberField(usage, "cacheWriteTokens") ?? 0;
    reasoning += numberField(usage, "reasoningTokens") ?? 0;
  }

  return {
    type: "usage",
    cumulative: true,
    usage: usageOf({
      input,
      output,
      cachedTokens: cached > 0 ? cached : undefined,
      cacheWriteTokens: written > 0 ? written : undefined,
      reasoningTokens: reasoning > 0 ? reasoning : undefined,
    }),
    raw: report,
  };
}

/** Parser for `copilot -p … --output-format json` (plus its usage file). */
export function createCopilotParser(context?: CliLaunchContext): CliStreamParser {
  let started = false;
  let sessionRef: string | undefined;

  const parser = jsonLinesParser(
    (record): CliParsedEvent[] => {
      const events: CliParsedEvent[] = [];
      const type = stringField(record, "type");
      const data = recordField(record, "data");

      if (!started) {
        started = true;
        events.push({
          type: "session.started",
          sessionRef: stringField(data, "sessionId"),
          raw: record,
        });
      }

      switch (type) {
        case "assistant.message_delta": {
          const text = stringField(data, "deltaContent") ?? "";

          if (text.length > 0) {
            events.push({ type: "message", text, delta: true, raw: record });
          }
          break;
        }
        case "assistant.message": {
          const text = stringField(data, "content") ?? "";

          if (text.length > 0) {
            events.push({ type: "message", text, delta: false, raw: record });
          }
          break;
        }
        case "tool.execution_start":
          events.push({
            type: "tool.call",
            id: stringField(data, "toolCallId") ?? "",
            name: stringField(data, "toolName") ?? "",
            input: data?.arguments,
            raw: record,
          });
          break;
        case "tool.execution_complete": {
          const success = data?.success === true;

          events.push({
            type: "tool.result",
            id: stringField(data, "toolCallId") ?? "",
            output: success
              ? outputText(recordField(data, "result")?.content)
              : (stringField(recordField(data, "error"), "message") ?? "tool failed"),
            isError: !success,
            raw: record,
          });
          break;
        }
        case "session.error":
          events.push({
            type: "error",
            message: stringField(data, "message") ?? "Copilot session error",
            fatal: true,
            raw: record,
          });
          break;
        case "result":
          sessionRef = stringField(record, "sessionId") ?? sessionRef;
          break;
        case "error":
          events.push({
            type: "error",
            message: stringField(record, "message") ?? "error",
            raw: record,
          });
          break;
      }

      return events;
    },
    () => {
      const usage = usageFileEvent(context);

      return usage !== undefined ? [usage] : [];
    },
  );

  return { ...parser, sessionRef: () => sessionRef };
}
