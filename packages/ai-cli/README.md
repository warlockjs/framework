# @warlock.js/ai-cli

> Drive vendor coding-agent CLIs (Claude Code, Codex, Copilot, Cursor, Grok, …) as first-class `@warlock.js/ai` agents.

Many teams run the vendors' own agent CLIs on the subscriptions they already pay for. This package launches those CLIs headless and reduces each vendor's stream to **one event model**. You get resume, process-tree cancellation, usage, per-run MCP servers, and an `ai.agent` model adapter.

Built-in adapters, each one verified against the CLI's real `--help` or its official docs:

- Claude Code
- Codex
- Antigravity
- Qwen Code
- Kimi Code
- Cursor
- Copilot
- Grok Build
- OpenCode
- Amp
- Factory Droid
- Mistral Vibe
- Aider
- Reasonix

## Install

```bash
npm install @warlock.js/ai @warlock.js/ai-cli
```

The vendor CLIs are not dependencies; install the ones you use. The package itself uses only Node built-ins (`node:child_process`, `node:fs`).

## Quick start

```ts
import { cli } from "@warlock.js/ai-cli";

const claude = cli.claudeCode({ model: "sonnet", apiKey: process.env.ANTHROPIC_API_KEY });
const session = await claude.run("Fix the failing test", { cwd: "/srv/acme-api" });

for await (const event of session.events) {
  if (event.type === "message" && event.delta) process.stdout.write(event.text);
  if (event.type === "tool.call") console.log("\n→", event.name);
}

const { status, text, usage, sessionRef, exitCode } = await session.done();
```

Importing the package also registers `ai.cli` on the shared `ai` object. There is one factory per vendor: `cli.claudeCode`, `cli.codex`, `cli.antigravity`, `cli.qwenCode`, `cli.kimi`, `cli.cursor`, `cli.copilot`, `cli.grok`, `cli.opencode`, `cli.amp`, `cli.droid`, `cli.mistralVibe`, `cli.aider` and `cli.reasonix`. `cli.custom(adapter)` takes your own adapter.

## What you get

- **Events:** `session.started`, `message` (deltas or complete), `tool.call`, `tool.result`, `usage`, `error`, `session.ended`.
- **Result:** `done()` resolves `{ status, text, messages, usage, sessionRef, exitCode, error, stderr }` and never rejects.
- **Resume** with `{ resume: sessionRef }`. **Cancel** with `signal`, `session.cancel()` or `timeoutMs`; the CLI's whole process tree is killed.
- **Permissions:** `"standard"` by default (the CLI's own non-interactive rules). Each vendor's approve-everything mode needs an explicit `permission: "bypass"`.
- **Secrets never in argv:** API keys travel in the environment. MCP servers are written to a 0600 file in a private per-run directory. Each run gets a private config home by default (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, …).
- **Capability probe:** the installed CLI's `--help` must list every flag the adapter uses, otherwise the run fails up front, naming the flag and the version.
- **Windows:** `PATHEXT` lookup. npm `.cmd` shims run as `node <script>`; other batch files fall back to `cmd.exe` with safe quoting. The prompt moves to stdin when argv cannot carry it.
- **`ai.agent` integration:** `cli.codex().model()` is a `ModelContract`, so budget, guardrail, observer and fallback middleware apply.

## Documentation

- [Run coding CLIs as agents](https://warlock.js.org/v/latest/ai/cli-agents/run-cli-agents/)
- [Vendor adapters](https://warlock.js.org/v/latest/ai/cli-agents/vendors/) — flags, stream formats and verification per CLI
- [Security and platforms](https://warlock.js.org/v/latest/ai/cli-agents/security-and-platforms/)
- [Write an adapter](https://warlock.js.org/v/latest/ai/cli-agents/custom-adapter/)

## License

MIT
