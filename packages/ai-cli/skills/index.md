---
description: "Drive vendor coding-agent CLIs headless as @warlock.js/ai agents — Claude Code, Codex, Antigravity, Qwen Code, Kimi Code, Cursor, Copilot, Grok Build, OpenCode, Amp, Factory Droid, Mistral Vibe, Aider, Reasonix. Exports `cli`, `createCliAgent`, `cliModel`, `CliError`, the per-vendor adapters and the adapter building blocks; registers `ai.cli`. Use for: run a coding CLI from code, stream its tool calls and text as one event model, resume or cancel a CLI session, read its token usage, give a CLI per-run MCP servers without leaking tokens, use a CLI as an ai.agent model, add an adapter for another CLI. Not this package: direct model calls → @warlock.js/ai with a provider adapter; a policy-jailed shell/file workspace → @warlock.js/ai-workspace; MCP clients and servers → @warlock.js/ai-tools."
---

# @warlock.js/ai-cli

Many teams run the vendors' own agent CLIs on the subscriptions they already pay for. This package launches those CLIs headless, one session per run, and reduces each vendor's JSONL stream to one event model, with resume, process-tree cancellation, usage and per-run MCP servers. Importing the package registers `ai.cli` on the shared `ai` object.

## The 80% path

1. Pick a vendor factory and run a prompt; read `session.events` and `await session.done()` (`run-cli-agents`).
2. Resume with `done().sessionRef`, cancel with a `signal`, and attach MCP servers with `mcp`.
3. To give the CLI to `ai.agent` (budgets, guardrails, observers), use `agent.model()`.
4. For a CLI that is not built in, write an adapter (`write-a-cli-adapter`).

## Conventions and pitfalls

- `permission` defaults to `"standard"` (the CLI's own non-interactive rules); `"bypass"` must be opted into. Kimi Code has no standard mode and requires `"bypass"`.
- Secrets go in `apiKey`, `env`, or MCP `env`/`headers`, never in `args`.
- The default home is private per run: authenticate with `apiKey`/`env`, or pass a home you logged in to.
- `run()` rejects only for setup problems (`CliError`: `not-found`, `capability`, `unsupported-option`, …). `done()` never rejects; check `status`.
- The installed CLI's `--help` must list every flag the adapter uses, so a CLI release with renamed flags fails closed with the flag and version in the error.
