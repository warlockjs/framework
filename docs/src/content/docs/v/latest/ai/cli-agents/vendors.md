---
title: "Vendor adapters"
description: "The 14 built-in @warlock.js/ai-cli adapters — the headless flags, stream format, MCP route, config home, API key and permission behaviour of each CLI, and the version and source each was verified against."
sidebar:
  order: 2
  label: "Vendor adapters"
---

Each adapter records the CLI version it was verified against, the official sources, and whether it was checked against the real `--help` (`help`) or against the official docs and source only (`docs`). The record is on `adapter.verification`. Every check was made on **2026-10-17**.

"Docs only" means the CLI ships through a curl installer or needs a Python version this check could not run. Those adapters still go through the [capability probe](../security-and-platforms/#capability-probe), which reads the installed binary's `--help` before the first run, so a flag that does not exist fails the run up front.

## Summary

| Factory           | Command        | Verified against              | Prompt via                   | Stream                               | MCP                                | Home variable               | API key variable                       |
| ----------------- | -------------- | ----------------------------- | ---------------------------- | ------------------------------------ | ---------------------------------- | --------------------------- | -------------------------------------- |
| `cli.claudeCode`  | `claude`       | 2.1.302 · help                | argv, stdin                  | `--output-format stream-json`        | `--mcp-config <file>`              | `CLAUDE_CONFIG_DIR`         | `ANTHROPIC_API_KEY`                    |
| `cli.codex`       | `codex`        | 0.163.0 · help                | argv, stdin (`-`)            | `exec --json`                        | `config.toml` / `-c` + env         | `CODEX_HOME`                | `CODEX_API_KEY`                        |
| `cli.antigravity` | `agy`          | 1.4.0 · docs                  | argv, stdin JSON             | `--output-format stream-json`        | `~/.gemini/config/mcp_config.json` | `HOME` (no own variable)    | `GEMINI_API_KEY`                       |
| `cli.qwenCode`    | `qwen`         | 0.25.2 · help                 | argv, stdin                  | `--output-format stream-json`        | `--mcp-config <file>`              | `QWEN_HOME`                 | `OPENAI_API_KEY`                       |
| `cli.kimi`        | `kimi`         | 2.2.0 · help                  | argv (`-p`)                  | `--output-format stream-json`        | `$KIMI_CODE_HOME/mcp.json`         | `KIMI_CODE_HOME`            | `KIMI_MODEL_API_KEY`                   |
| `cli.cursor`      | `cursor-agent` | 2026.10.16-e3cb207 · docs     | argv, stdin                  | `--output-format stream-json`        | `~/.cursor/mcp.json`               | `HOME`, `CURSOR_CONFIG_DIR` | `CURSOR_API_KEY`                       |
| `cli.copilot`     | `copilot`      | 1.0.98 · help                 | argv (`-p`), stdin           | `--output-format json`               | `--additional-mcp-config @<file>`  | `COPILOT_HOME`              | `COPILOT_GITHUB_TOKEN`                 |
| `cli.grok`        | `grok`         | 1.0.62 · docs                 | argv, `--prompt-file`        | `--output-format streaming-json`     | `$GROK_HOME/config.toml`           | `GROK_HOME`                 | `XAI_API_KEY`                          |
| `cli.opencode`    | `opencode`     | 1.19.3 · help                 | argv, stdin                  | `run --format json`                  | `OPENCODE_CONFIG=<file>`           | `XDG_*`                     | provider's own                         |
| `cli.amp`         | `amp`          | 0.0.1792254886-g14d018 · help | argv, stdin                  | `-x --stream-json`                   | `--mcp-config <file>`              | `XDG_*`                     | `AMP_API_KEY`                          |
| `cli.droid`       | `droid`        | 0.244.0 · help                | argv, `--file`               | `exec --output-format stream-json`   | `<home>/.factory/mcp.json`         | `FACTORY_HOME_OVERRIDE`     | `FACTORY_API_KEY`                      |
| `cli.mistralVibe` | `vibe`         | 2.26.1 · docs                 | argv, `--prompt-file`, stdin | `--output streaming` + `export.json` | `$VIBE_HOME/config.toml`           | `VIBE_HOME`                 | `MISTRAL_API_KEY`                      |
| `cli.aider`       | `aider`        | 0.86.2 · docs                 | argv, `--message-file`       | plain text + analytics log           | not supported                      | `HOME`                      | provider's own                         |
| `cli.reasonix`    | `reasonix`     | 2.43.0 · help                 | argv, stdin                  | `run --output-format stream-json`    | `$REASONIX_HOME/config.toml`       | `REASONIX_HOME`             | `DEEPSEEK_API_KEY` (written to `.env`) |

"Prompt via" lists the transports in order of preference. The runner moves the prompt to the next transport when argv cannot carry it, for example a long prompt, or a prompt `cmd.exe` cannot quote on Windows. A prompt that starts with `-` gets one leading space so no CLI parses it as a flag.

## Permission behaviour

| Factory           | `"standard"` (default)                                                                                                   | `"bypass"`                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `cli.claudeCode`  | Print mode auto-denies anything that would prompt.                                                                       | `--dangerously-skip-permissions` (refused as root outside a sandbox) |
| `cli.codex`       | Approval policy "never" with the **read-only** sandbox; allow edits with `args: ["-c", "sandbox_mode=workspace-write"]`. | `--dangerously-bypass-approvals-and-sandbox`                         |
| `cli.antigravity` | Soft-denies tools that need approval; the run continues and exits 0.                                                     | `--dangerously-skip-permissions`                                     |
| `cli.qwenCode`    | Auto-denies tools that need confirmation (`permission_denials`).                                                         | `--yolo`                                                             |
| `cli.kimi`        | **Refused**: print mode runs every tool call without asking.                                                             | Required, to accept that behaviour                                   |
| `cli.cursor`      | Allowlist mode: unlisted actions are rejected, changes only proposed.                                                    | `--force`                                                            |
| `cli.copilot`     | Unapproved tool requests are auto-denied.                                                                                | `--allow-all`                                                        |
| `cli.grok`        | Every approval request is answered "cancelled".                                                                          | `--always-approve`                                                   |
| `cli.opencode`    | OpenCode's own rules (permissive by default); asks are auto-rejected.                                                    | `--auto`                                                             |
| `cli.amp`         | Amp's own rules (tools run without approval by default); approvals are rejected.                                         | `--dangerously-allow-all` (accepted, not in `--help`)                |
| `cli.droid`       | **Read-only** autonomy; raise with `args: ["--auto", "medium"]`.                                                         | `--skip-permissions-unsafe`                                          |
| `cli.mistralVibe` | Every approval is auto-denied (the default agent auto-approves file edits).                                              | `--auto-approve`                                                     |
| `cli.aider`       | Edits apply without approval; suggested shell commands never run headless.                                               | Same as standard (Aider has no other mode)                           |
| `cli.reasonix`    | "Ask" mode refuses writes headless (exit 4 in an untrusted folder).                                                      | `--yolo`                                                             |

## Model and effort

| Factory           | `model`                              | `effort` mapping                                 |
| ----------------- | ------------------------------------ | ------------------------------------------------ |
| `cli.claudeCode`  | `--model`                            | `--effort` low · medium · high · xhigh · max     |
| `cli.codex`       | `--model`                            | `-c model_reasoning_effort=` low … max           |
| `cli.antigravity` | `--model`                            | `--effort` low · medium · high                   |
| `cli.qwenCode`    | `--model`                            | refused (a settings value, not a flag)           |
| `cli.kimi`        | `--model` (alias from `config.toml`) | refused (a config value)                         |
| `cli.cursor`      | `--model`                            | refused (part of the model id)                   |
| `cli.copilot`     | `--model`                            | `--reasoning-effort` none … max                  |
| `cli.grok`        | `--model`                            | `--reasoning-effort` none … max                  |
| `cli.opencode`    | `--model provider/model`             | `--variant` (provider-specific; passed as-is)    |
| `cli.amp`         | refused (the mode picks the model)   | `--mode` low · medium · high · ultra (for `max`) |
| `cli.droid`       | `--model`                            | `--reasoning-effort` (per model, passed as-is)   |
| `cli.mistralVibe` | `VIBE_ACTIVE_MODEL` env              | refused (a per-model config value)               |
| `cli.aider`       | `--model` (always pass one)          | `--reasoning-effort` low · medium · high         |
| `cli.reasonix`    | `--model`                            | `--effort` disabled · low · high · max           |

Levels are mapped with the framework rule: an exact level wins, otherwise the nearest higher level the vendor has, and a level above the vendor's highest is clamped to it. An adapter without an effort control refuses `effort` with `CliError` `unsupported-option`, rather than ignoring it.

## Stream notes per vendor

- **Claude Code** — `system/init` carries the session id; `stream_event` text deltas; `assistant`/`user` messages carry `tool_use`/`tool_result`; the final `result` has `usage` (Anthropic semantics) and `total_cost_usd`. `--verbose` is required with stream-json in print mode. Sources: [headless](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference), [MCP](https://code.claude.com/docs/en/mcp).
- **Codex** — `thread.started` (id), `item.started`/`item.completed` items (`agent_message`, `command_execution`, `file_change`, `mcp_tool_call`, …), `turn.completed` with the thread's cumulative usage, `turn.failed`/`error`. No deltas, no cost. Resume is `codex exec resume <id>`. `--skip-git-repo-check` is always passed, so a run outside a git repository works. With a shared home, MCP goes through `-c mcp_servers.<name>.…` overrides that name environment variables (`env_vars`, `env_http_headers`), so values stay out of argv. Sources: [non-interactive mode](https://developers.openai.com/codex/noninteractive), [config reference](https://developers.openai.com/codex/config-reference).
- **Antigravity** — `{"event":…}` lines: `init` (`conversation_id`), `step_update` (`text_delta`, tool steps with call and result together), `result` (cumulative usage, `status`). Long prompts use the documented stdin protocol. An API key needs `"modelProvider": "gemini"`, which the adapter writes into a private home. Sources: [headless](https://antigravity.google/docs/cli/headless), [MCP](https://antigravity.google/docs/mcp).
- **Qwen Code** — Claude Code-compatible stream; `input_tokens` already include cached tokens; no cost. Sources: [headless](https://github.com/QwenLM/qwen-code/blob/v0.25.2/docs/users/features/headless.md).
- **Kimi Code** — the successor of the archived Python `kimi-cli`. It prints OpenAI-chat-shaped messages without deltas. The session id comes only in the final `session.resume_hint`, and no token usage is printed. Shell `KIMI_API_KEY` is not read; for key auth set `KIMI_MODEL_NAME` (and the provider type and base URL) in `env`, and `apiKey` becomes `KIMI_MODEL_API_KEY`. Sources: [docs](https://moonshotai.github.io/kimi-code/).
- **Cursor** — `system/init`, `assistant` messages, `tool_call` `started`/`completed` (the tool is the single key, e.g. `readToolCall`), and a final `result` with `usage` (input net of cache). Errors are plain stderr with a non-zero exit. `--trust` is passed because print mode exits in a directory that was never trusted. Sources: [headless](https://cursor.com/docs/cli/headless), [output format](https://cursor.com/docs/cli/reference/output-format).
- **Copilot** — `{type,data}` session events (`assistant.message_delta`, `tool.execution_start`/`_complete`, `session.error`) and a final `result` with the session id. Tokens are not in the stream, so the adapter passes `--usage-output-file` and reads it afterwards. Billing is in premium requests, so there is no USD cost. Sources: [run programmatically](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically).
- **Grok Build** — `text` deltas, `tool_call`/`tool_call_update`, `usage` per response, and a final `end` with the session id, totals and `total_cost_usd`. Sources: [headless scripting](https://docs.x.ai/build/cli/headless-scripting), [repo guide](https://github.com/xai-org/grok-build).
- **OpenCode** — `text` blocks (no deltas), `tool_use` (call and result together), `step_finish` per step with `cost` and tokens, and `error`. `--dir` is passed because OpenCode prefers a stale `PWD`. Sources: [CLI](https://opencode.ai/docs/cli/), [MCP servers](https://opencode.ai/docs/mcp-servers/).
- **Amp** — Claude Code-compatible stream, no deltas, no cost. Threads are left unarchived so they can be continued. Sources: [streaming JSON](https://ampcode.com/docs/cli/streaming-json).
- **Factory Droid** — `system/init`, whole `message` records, `tool_call`/`tool_result`, a final `completion` (`finalText`, usage), and `error`. The home is relocated with `FACTORY_HOME_OVERRIDE`. That variable is found in the shipped code, not in the docs, and was confirmed with `droid mcp list`. Sources: [droid exec](https://docs.factory.ai/cli/droid-exec/overview).
- **Mistral Vibe** — completed history entries only (`message`, `effect` = tool call + result). Usage, cost, outcome and session id come from `--output-dir`'s `export.json`, which the parser reads when the stream ends. Sources: [repo](https://github.com/mistralai/mistral-vibe/tree/v2.26.1).
- **Aider** — no machine-readable output. The parser reads the plain text: the banner, the reply, `Tokens: … sent, … received. Cost: …`, `Applied edit to <path>` (an `edit` tool call) and `Commit …`. Exact usage comes from the local `--analytics-log`. Aider exits 0 when the model call fails, so `litellm.*Error` lines are reported as fatal. There are no session ids, so `resume` is refused. Sources: [scripting](https://aider.chat/docs/scripting.html), [options](https://aider.chat/docs/config/options.html).
- **Reasonix** — `kind`-tagged lines (`text` deltas, `message`, `tool_dispatch`/`tool_result`, `usage`, `turn_done`) and a final `{"type":"result"}`. Provider keys are read only from `$REASONIX_HOME/.env`, so `apiKey` is written there (mode 0600) in a private home. Sources: [CLI](https://github.com/esengine/DeepSeek-Reasonix/blob/v2.43.0/docs/CLI.md).

The recorded stream samples behind the adapter tests live in the package's `fixtures/` folder, one folder per vendor.
