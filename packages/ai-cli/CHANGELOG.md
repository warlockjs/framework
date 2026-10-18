# Changelog — @warlock.js/ai-cli

All notable changes to `@warlock.js/ai-cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.33.0 - 2026-10-19

### Changed

- Lockstep release; package APIs are unchanged.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.31.0 - 2026-10-18

### Added

- First release: drive vendor coding-agent CLIs headless as agents. `cli.<vendor>(options)` (also `ai.cli.<vendor>` after importing the package) returns a CLI agent. `run(prompt, { cwd, resume, signal, timeoutMs, model, effort, permission, mcp, env, apiKey, args })` starts one session, and returns `CliSession` with `events`, `done()` and `cancel()`.
- Adapters for Claude Code, Codex, Antigravity, Qwen Code, Kimi Code, Cursor, Copilot, Grok Build, OpenCode, Amp, Factory Droid, Mistral Vibe, Aider and Reasonix. Each records the CLI version, the official sources, and whether it was verified against the real `--help` or against the docs (`adapter.verification`).
- One event model for every vendor: `session.started`, `message` (deltas and complete messages), `tool.call`, `tool.result`, `usage`, `error` and `session.ended`. `session.done()` resolves `{ status, text, messages, usage, sessionRef, exitCode, signal, error, stderr, durationMs }` and never rejects.
- Capability probe: before the first run, the CLI's `--version` and help screens are read, and every flag the launch plan relies on must be listed. A missing flag fails the run with `CliError` (`type: "capability"`), naming the flag and the installed version.
- Secrets never go to argv:
  - API keys travel in the environment (`apiKey`).
  - Per-run MCP servers are written as a mode-0600 file in a private per-run directory, removed after the run.
  - Each run gets a private config home by default (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, `GROK_HOME`, …). `home` also takes a path you own, or `"inherit"`.
- `permission` defaults to `"standard"`, the CLI's own non-interactive approval rules. Each vendor's approve-everything mode is used only with `permission: "bypass"`.
- Windows spawn rules:
  - `PATHEXT` lookup.
  - npm and pnpm `.cmd` shims are unwrapped to `node <script>` (or their native `.exe`).
  - Other batch files fall back to `cmd.exe /d /v:off /s /c` with every argument quoted, refusing bytes `cmd.exe` cannot carry.
  - The prompt moves to stdin or a prompt file when argv cannot carry it.
- Cancellation (`signal`, `cancel()`) and `timeoutMs` kill the CLI's whole process tree. On POSIX this is its own process group, with SIGTERM then SIGKILL; on Windows, `taskkill /T /F` on its PID.
- `agent.model(config)` / `cliModel(agent, config)` wraps a CLI agent as a `ModelContract`, so `ai.agent` and its budget, guardrail, observer and fallback middleware can drive a CLI.
- `createCliAgent(adapter, options)` / `cli.custom(adapter)` and the documented `CliAdapter` interface let apps add vendors. The building blocks are exported: `jsonLinesParser`, `createClaudeStreamParser`, `mcpServersJson`, `toToml`, `mapEffort`, `requirePrivateHome` and more.

### Fixed

- `session.cancel()`, or aborting the run's `signal`, after the run has finished no longer signals the CLI's old process group. Once the CLI's pipes close, cancellation is a no-op, so a `finally { session.cancel() }` cannot reach an unrelated process that reused the pid. The abort listener is also removed when the run settles.
