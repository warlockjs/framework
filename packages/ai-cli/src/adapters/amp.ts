import path from "node:path";
import type { CliAdapter, CliLaunchFile } from "../contracts";
import { createClaudeStreamParser } from "./claude-stream";
import { argvPrompt, jsonFile, mapEffort, mcpServersJson, unsupportedOption } from "./shared";

/**
 * Amp (`amp`, npm `@ampcode/cli`; `@sourcegraph/amp` is a shim to it).
 *
 * Verified against the real `amp --help` of 0.0.1792254886-g14d018 and the
 * docs (`ampcode.com/docs/cli/{streaming-json,execute-mode,settings}`,
 * `/docs/tools`), 2026-10-17.
 *
 * - Headless: `amp -x <prompt> --stream-json` (with `-x` and no message,
 *   stdin is the prompt); resume is `amp threads continue <T-id> -x …`.
 *   Threads are kept unarchived (`--no-archive-after-execute`) so they can
 *   be continued.
 * - Stream: Claude Code-compatible (`system/init` with `session_id`
 *   `T-…`, `assistant` text/`tool_use`, `user` `tool_result`, `result`),
 *   no deltas and no cost.
 * - Model: Amp has no model flag; the mode (`-m low|medium|high|ultra`)
 *   picks model and effort, so `effort` maps to the mode and `model` is
 *   refused.
 * - Permissions: Amp's own rules (tools run without approval by default;
 *   anything that needs approval is rejected in execute mode). Bypass passes
 *   `--dangerously-allow-all`, which the CLI accepts but no longer lists in
 *   `--help`, so it is not part of the capability probe — a CLI that drops
 *   it rejects the run as an unknown option.
 * - MCP: `--mcp-config <file>` holding the server map itself (no
 *   `mcpServers` wrapper), written to the run directory.
 * - Home: Amp follows XDG (`$XDG_CONFIG_HOME/amp/settings.json`); auth
 *   `AMP_API_KEY`; update checks off with `AMP_SKIP_UPDATE_CHECK=1`.
 */
export const ampAdapter: CliAdapter = {
  name: "amp",
  title: "Amp",
  command: "amp",
  apiKeyEnv: ["AMP_API_KEY"],
  homeEnv: ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"],
  transports: ["argv", "stdin"],
  effort: true,
  mcp: true,
  probe: { help: [["--help"]], version: ["--version"] },
  verification: {
    version: "0.0.1792254886-g14d018",
    verifiedBy: "help",
    sources: [
      "https://ampcode.com/docs/cli/streaming-json",
      "https://ampcode.com/docs/cli/execute-mode",
      "https://ampcode.com/docs/cli/settings",
    ],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    if (context.model !== undefined) {
      throw unsupportedOption(
        ampAdapter,
        "Amp has no model flag; its mode picks the model — use `effort` instead of `model`.",
      );
    }

    const args: string[] =
      context.resume !== undefined ? ["threads", "continue", context.resume] : [];
    const requires = ["--execute", "--stream-json", "--no-archive-after-execute"];
    const files: CliLaunchFile[] = [];

    if (context.resume !== undefined) {
      requires.push("threads");
    }

    args.push("--stream-json", "--no-archive-after-execute");

    if (context.effort !== undefined) {
      args.push(
        "--mode",
        mapEffort(context.effort, { low: "low", medium: "medium", high: "high", max: "ultra" }),
      );
      requires.push("--mode");
    }

    if (context.permission === "bypass") {
      args.push("--dangerously-allow-all");
    }

    if (context.mcp !== undefined) {
      const file = path.join(context.runDir, "amp-mcp.json");

      files.push({ path: file, content: jsonFile(mcpServersJson(context.mcp)) });
      args.push("--mcp-config", file);
      requires.push("--mcp-config");
    }

    const env: Record<string, string> = { AMP_SKIP_UPDATE_CHECK: "1" };

    if (context.home !== undefined) {
      env.XDG_CONFIG_HOME = path.join(context.home, "config");
      env.XDG_DATA_HOME = path.join(context.home, "data");
      env.XDG_STATE_HOME = path.join(context.home, "state");
      env.XDG_CACHE_HOME = path.join(context.home, "cache");
    }

    return {
      args,
      tail:
        context.transport === "argv" ? ["--execute", argvPrompt(context.prompt)] : ["--execute"],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env,
      files,
      requires,
    };
  },
  parser: () => createClaudeStreamParser({ usage: "anthropic", vendor: "Amp" }),
};
