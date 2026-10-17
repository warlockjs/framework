# `@warlock.js/ai-cli` — skills index

Per-task skills. Cross-references name the topic ("the `<topic>` topic"), and for another package add its skill ("the `<topic>` topic of the `warlock-js-<pkg>` skill").

## Skills

### `run-cli-agents`

Drive a vendor coding CLI headless with `cli.<vendor>({...})` / `ai.cli.<vendor>` — `run(prompt, { cwd, resume, signal, model, effort, permission, mcp, env })`, the unified `session.events` (`session.started`, `message`, `tool.call`, `tool.result`, `usage`, `error`, `session.ended`), `session.done()` (`status`, `text`, `usage`, `sessionRef`, `exitCode`), resume, cancellation and timeouts, the opt-in `permission: "bypass"`, per-run MCP servers, config homes, `CliError` types, and `agent.model()` to run a CLI as an `ai.agent` model. Load when orchestrating Claude Code, Codex, Copilot, Cursor, Grok, Kimi, Qwen Code, OpenCode, Amp, Droid, Antigravity, Mistral Vibe, Aider or Reasonix from code.

### `write-a-cli-adapter`

Implement a `CliAdapter` for a coding CLI the package does not ship — the launch plan (`args`, `tail`, `stdin`, `env`, `files`, `requires`), the stream parser (`jsonLinesParser`, `sessionRef()`, reading a result file in `end()`), the verification record, and testing against a recorded stream and `--help`. Load when adding a vendor or adjusting an adapter for a new CLI release.
