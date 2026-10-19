---
description: "Run vendor coding CLIs headless as Warlock AI agents. Exports `cli`, `createCliAgent`, `cliModel`, `CliError` and adapter building blocks; registers `ai.cli`. Use for: launch Claude Code, Codex, Qwen Code or another supported CLI from code, stream tool calls and text, resume or cancel a session, read usage, attach per-run MCP servers, use a CLI as an ai.agent model, or implement an adapter. Not this package: direct model calls → @warlock.js/ai plus a provider adapter; a policy-jailed file and shell workspace → @warlock.js/ai-workspace; MCP clients and servers → @warlock.js/ai-tools."
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
- `run()` rejects only for setup problems (`CliError`: "not-found", `capability`, "unsupported-option", …). `done()` never rejects; check `status`.
- The installed CLI's `--help` must list every flag the adapter uses, so a CLI release with renamed flags fails closed with the flag and version in the error.
