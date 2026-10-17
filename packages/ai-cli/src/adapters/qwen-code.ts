import path from "node:path";
import type { CliAdapter, CliLaunchFile } from "../contracts";
import { createClaudeStreamParser } from "./claude-stream";
import { argvPrompt, jsonFile, mcpServersJson } from "./shared";

/**
 * Qwen Code (`qwen`, npm `@qwen-code/qwen-code`), a Gemini CLI fork.
 *
 * Verified against the real `qwen --help` of 0.25.2 and the docs/source at
 * tag v0.25.2 (`docs/users/features/headless.md`, `nonInteractive/types.ts`),
 * 2026-10-17.
 *
 * - Headless: positional prompt (`-p` is deprecated) with
 *   `--output-format stream-json`; piped stdin is used as the prompt when no
 *   positional prompt is given.
 * - Stream: the Claude Code `stream-json` shape (`system/init`, `assistant`,
 *   `user` tool results, `result`), with `input_tokens` that already include
 *   cached tokens and no cost field.
 * - Permissions: headless auto-denies tools that need confirmation (the tool
 *   result says so and `permission_denials` lists it); bypass is `--yolo`.
 * - MCP: `--mcp-config <file>` with `{"mcpServers":…}` — written to the run
 *   directory, so it works with any home. Remote servers use `httpUrl`
 *   (streamable HTTP) or `url` (SSE).
 * - Home: `QWEN_HOME`. Auth depends on the auth type: `OPENAI_API_KEY`
 *   (default for `apiKey`), or `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` with
 *   `--auth-type` in `args`.
 * - Effort has no flag (it is the `model.reasoningEffort` setting), so
 *   `effort` is refused.
 */
export const qwenCodeAdapter: CliAdapter = {
  name: "qwen-code",
  title: "Qwen Code",
  command: "qwen",
  apiKeyEnv: ["OPENAI_API_KEY"],
  homeEnv: ["QWEN_HOME"],
  transports: ["argv", "stdin"],
  effort: false,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "0.25.2",
    verifiedBy: "help",
    sources: [
      "https://qwenlm.github.io/qwen-code-docs/",
      "https://github.com/QwenLM/qwen-code/blob/v0.25.2/docs/users/features/headless.md",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["--output-format", "stream-json"];
    const requires = ["--output-format", "stream-json"];
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
      args.push("--yolo");
      requires.push("--yolo");
    }

    if (context.mcp !== undefined) {
      const file = path.join(context.runDir, "mcp.json");

      files.push({
        path: file,
        content: jsonFile({ mcpServers: mcpServersJson(context.mcp, { httpUrlKey: "httpUrl" }) }),
      });
      args.push("--mcp-config", file);
      requires.push("--mcp-config");
    }

    return {
      args,
      tail: context.transport === "argv" ? [argvPrompt(context.prompt)] : [],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env: {
        ...(context.home !== undefined ? { QWEN_HOME: context.home } : {}),
        QWEN_CODE_SUPPRESS_YOLO_WARNING: "1",
      },
      files,
      requires,
    };
  },
  parser: () => createClaudeStreamParser({ usage: "inclusive", vendor: "Qwen Code" }),
};
