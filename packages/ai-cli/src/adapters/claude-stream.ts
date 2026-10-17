import type { CliParsedEvent, CliStreamParser, CliUsage } from "../contracts";
import {
  asArray,
  asRecord,
  jsonLinesParser,
  numberField,
  outputText,
  recordField,
  stringField,
  type JsonRecord,
} from "../stream/json-lines";
import { anthropicUsage, usageOf } from "./shared";

/**
 * How a Claude-style stream reports input tokens.
 *
 * - `anthropic` — `input_tokens` excludes cache reads/writes (Claude Code).
 * - `inclusive` — `input_tokens` already includes cached tokens (Qwen Code).
 */
export type ClaudeStreamUsage = "anthropic" | "inclusive";

function inclusiveUsage(usage: JsonRecord | undefined, costUSD?: number): CliUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const cached = numberField(usage, "cache_read_input_tokens");
  const written = numberField(usage, "cache_creation_input_tokens");

  return usageOf({
    input: numberField(usage, "input_tokens"),
    output: numberField(usage, "output_tokens"),
    total: numberField(usage, "total_tokens"),
    cachedTokens: cached !== undefined && cached > 0 ? cached : undefined,
    cacheWriteTokens: written !== undefined && written > 0 ? written : undefined,
    costUSD,
  });
}

/**
 * Parser for the Claude Code `stream-json` format, which several CLIs
 * reproduce (Qwen Code, Grok Build's `streaming-messages-json`):
 *
 * - `{"type":"system","subtype":"init","session_id","model",…}`
 * - `{"type":"assistant","message":{"content":[text | tool_use | thinking]}}`
 * - `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id","content","is_error"}]}}`
 * - `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text"}}}`
 *   (only with partial messages enabled)
 * - `{"type":"result","subtype","is_error","result","session_id","usage","total_cost_usd"}`
 *
 * Per-message `usage` is ignored (Claude Code repeats it on every content
 * block of a message); the `result` totals are reported as cumulative usage.
 * Sub-agent traffic (`parent_tool_use_id` set) is reported like the main
 * thread's, so its tool calls stay visible.
 */
export function createClaudeStreamParser(
  options: { usage?: ClaudeStreamUsage; vendor?: string } = {},
): CliStreamParser {
  const style = options.usage ?? "anthropic";
  const vendor = options.vendor ?? "The CLI";

  return jsonLinesParser((record): CliParsedEvent[] => {
    switch (stringField(record, "type")) {
      case "system": {
        const subtype = stringField(record, "subtype");

        if (subtype?.startsWith("error") && stringField(record, "error") !== undefined) {
          return [{ type: "error", message: stringField(record, "error") ?? subtype, raw: record }];
        }

        return subtype === "init" || subtype === "session_start"
          ? [
              {
                type: "session.started",
                sessionRef: stringField(record, "session_id"),
                model: stringField(record, "model"),
                raw: record,
              },
            ]
          : [];
      }
      case "assistant": {
        const events: CliParsedEvent[] = [];

        for (const item of asArray(recordField(record, "message")?.content)) {
          const block = asRecord(item);
          const blockType = stringField(block, "type");

          if (blockType === "text") {
            const text = stringField(block, "text") ?? "";

            if (text.length > 0) {
              events.push({ type: "message", text, delta: false, raw: record });
            }
          } else if (blockType === "tool_use" || blockType === "server_tool_use") {
            events.push({
              type: "tool.call",
              id: stringField(block, "id") ?? "",
              name: stringField(block, "name") ?? "",
              input: block?.input,
              raw: record,
            });
          }
        }

        return events;
      }
      case "user": {
        const events: CliParsedEvent[] = [];

        for (const item of asArray(recordField(record, "message")?.content)) {
          const block = asRecord(item);

          if (stringField(block, "type") === "tool_result") {
            events.push({
              type: "tool.result",
              id: stringField(block, "tool_use_id") ?? "",
              output: outputText(block?.content),
              isError: block?.is_error === true,
              raw: record,
            });
          }
        }

        return events;
      }
      case "stream_event": {
        const event = recordField(record, "event");
        const delta = recordField(event, "delta");

        if (
          stringField(event, "type") === "content_block_delta" &&
          stringField(delta, "type") === "text_delta"
        ) {
          const text = stringField(delta, "text") ?? "";

          return text.length > 0 ? [{ type: "message", text, delta: true, raw: record }] : [];
        }

        return [];
      }
      case "result": {
        const events: CliParsedEvent[] = [];
        const cost = numberField(record, "total_cost_usd");
        const usage =
          style === "anthropic"
            ? anthropicUsage(recordField(record, "usage"), cost)
            : inclusiveUsage(recordField(record, "usage"), cost);

        if (usage !== undefined) {
          events.push({ type: "usage", usage, cumulative: true, raw: record });
        }

        const result = stringField(record, "result");

        if (record.is_error === true) {
          const errors = asArray(record.errors)
            .map((item) =>
              typeof item === "string" ? item : (stringField(asRecord(item), "message") ?? ""),
            )
            .filter((item) => item.length > 0)
            .join("; ");
          const message =
            stringField(recordField(record, "error"), "message") ||
            stringField(record, "error") ||
            errors ||
            result ||
            `${vendor} run ended with ${stringField(record, "subtype") ?? "an error"}`;

          events.push({ type: "error", message, fatal: true, raw: record });
        } else if (result !== undefined && result.length > 0) {
          events.push({ type: "message", text: result, delta: false, final: true, raw: record });
        }

        return events;
      }
      default:
        return [];
    }
  });
}
