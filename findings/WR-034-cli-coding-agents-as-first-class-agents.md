# WR-034 — Drive vendor coding CLIs as first-class agents

- **Packages:** `@warlock.js/ai` 5.30.0 (agents, providers)
- **Classification:** feature request
- **Found:** 2026-10-17, while an app built one adapter per vendor CLI (Claude Code, Codex, Antigravity, Qwen
  Code, Kimi, Cursor, Copilot, Grok, OpenCode, Amp, Droid, Mistral Vibe, Aider, Reasonix) to run them as
  team members and workers.

## Need

Many teams don't call models directly. They run the vendors' own agent CLIs, on the subscriptions they
already pay for, and want to orchestrate them: start a session, stream its events, resume it, inject tools,
cancel it, and read usage. Today `@warlock.js/ai` only models direct provider calls (`ai.agent` over an SDK
adapter).

## What the app had to build (by hand, per vendor)

- **Launch plan:**
  - headless/print flag;
  - model and effort flags;
  - resume reference;
  - permission mode, mapped to "bypass" or "standard";
  - per-run MCP config, written as a file inside a private home so the token never sits in argv;
  - a private config home (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, ...);
  - an API key environment variable per engine.
- **Stream parser:** each vendor's JSONL/NDJSON reduced to one event model (`session.started`, `message`,
  `tool.call`, `tool.result`, `usage`, `session.ended`), plus usage extraction.
- **Capability probe:** read `--help` and require the flags the adapter uses, so a CLI version with
  different flags fails closed instead of misbehaving.
- **Windows:** `PATHEXT` lookup, npm `.cmd` shims resolved to `node <script>`, a `cmd.exe` fallback with safe
  quoting, and the prompt sent over stdin when argv can't carry it.

## Request

A provider-like abstraction, for example `@warlock.js/ai-cli`:

```ts
const claude = ai.cli.claudeCode({ home, model: "sonnet", security: "standard", mcp });
const session = await claude.run(prompt, { cwd, resume, signal });
for await (const event of session.events) { … }   // normalized events
const result = await session.done();               // final text, usage, session ref
```

Requested parts:
- a shared event model;
- capability descriptors with the help probe;
- adapters maintained alongside vendor releases, with recorded stream fixtures per version;
- the Windows spawn rules.

Optionally, let `ai.agent` use a CLI session as its "model", so existing middleware (budget, guardrails,
observers) applies.

## Impact

Every orchestration app re-derives undocumented stream shapes and flag sets, and they drift with each
vendor release. A framework-maintained adapter set with recorded fixtures would remove most of that churn.
