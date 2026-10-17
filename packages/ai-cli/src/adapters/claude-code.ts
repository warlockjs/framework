import path from "node:path";
import type { CliAdapter, CliLaunchFile } from "../contracts";
import { createClaudeStreamParser } from "./claude-stream";
import { jsonFile, mapEffort, mcpServersJson, argvPrompt } from "./shared";

/**
 * Claude Code (`claude`, npm `@anthropic-ai/claude-code`).
 *
 * Verified against the real `claude --help` of 2.1.302, the event types of
 * `@anthropic-ai/claude-agent-sdk` 0.3.302 and the docs
 * (`code.claude.com/docs/en/{headless,cli-reference,mcp,env-vars,
 * permission-modes}`), 2026-10-17.
 *
 * - Headless: `claude -p --output-format stream-json --verbose
 *   --include-partial-messages <prompt>` (`--verbose` is required with
 *   stream-json in print mode); piped stdin is the prompt when no positional
 *   prompt is given.
 * - Stream: `system/init` (`session_id`), `stream_event` text deltas,
 *   `assistant` messages (text / `tool_use`), `user` messages with
 *   `tool_result`, and a final `result` (`result`, `usage`,
 *   `total_cost_usd`, `is_error`, `errors[]`).
 * - Permissions: print mode auto-denies anything that would prompt; bypass
 *   is `--dangerously-skip-permissions` (Claude Code refuses it as root
 *   outside a recognised sandbox).
 * - MCP: `--mcp-config <file>` with `{"mcpServers":…}`, written to the run
 *   directory.
 * - Home: `CLAUDE_CONFIG_DIR`; auth `ANTHROPIC_API_KEY` (or a home you
 *   logged in to); auto-update off with `DISABLE_AUTOUPDATER=1`.
 */
export const claudeCodeAdapter: CliAdapter = {
  name: "claude-code",
  title: "Claude Code",
  command: "claude",
  apiKeyEnv: ["ANTHROPIC_API_KEY"],
  homeEnv: ["CLAUDE_CONFIG_DIR"],
  transports: ["argv", "stdin"],
  effort: true,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "2.1.302",
    verifiedBy: "help",
    sources: [
      "https://code.claude.com/docs/en/headless",
      "https://code.claude.com/docs/en/cli-reference",
      "https://code.claude.com/docs/en/mcp",
      "https://code.claude.com/docs/en/env-vars",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    const requires = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    const files: CliLaunchFile[] = [];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.effort !== undefined) {
      args.push(
        "--effort",
        mapEffort(context.effort, {
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "xhigh",
          max: "max",
        }),
      );
      requires.push("--effort");
    }

    if (context.resume !== undefined) {
      args.push("--resume", context.resume);
      requires.push("--resume");
    }

    if (context.permission === "bypass") {
      args.push("--dangerously-skip-permissions");
      requires.push("--dangerously-skip-permissions");
    }

    if (context.mcp !== undefined) {
      const file = path.join(context.runDir, "mcp.json");

      files.push({
        path: file,
        content: jsonFile({ mcpServers: mcpServersJson(context.mcp, { typeField: true }) }),
      });
      args.push("--mcp-config", file);
      requires.push("--mcp-config");
    }

    return {
      args,
      tail: context.transport === "argv" ? [argvPrompt(context.prompt)] : [],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env: {
        ...(context.home !== undefined ? { CLAUDE_CONFIG_DIR: context.home } : {}),
        DISABLE_AUTOUPDATER: "1",
      },
      files,
      requires,
    };
  },
  parser: () => createClaudeStreamParser({ usage: "anthropic", vendor: "Claude Code" }),
};
