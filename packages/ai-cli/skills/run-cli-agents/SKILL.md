---
name: run-cli-agents
description: 'Run vendor coding CLIs headless as agents with @warlock.js/ai-cli. Triggers: `ai.cli`, `cli.claudeCode`, `cli.codex`, `cli.antigravity`, `cli.qwenCode`, `cli.kimi`, `cli.cursor`, `cli.copilot`, `cli.grok`, `cli.opencode`, `cli.amp`, `cli.droid`, `cli.mistralVibe`, `cli.aider`, `cli.reasonix`, `createCliAgent`, `CliSession`, `session.events`, `session.done`, `CliEvent`, `CliResult`, `sessionRef`, `resume`, `permission: "bypass"`, `CliMcpServers`, `home: "private"`, `inheritEnv`, `CliError`, `agent.model`, `cliModel`; ''run claude code from node'', ''orchestrate codex / copilot / cursor as workers'', ''stream a CLI agent''s tool calls'', ''resume a CLI session'', ''cancel a coding CLI and its child processes'', ''read token usage from a CLI run'', ''give a CLI MCP servers without putting tokens in argv'', ''use a CLI as an ai.agent model''; typical import `import { cli } from "@warlock.js/ai-cli"`. Skip: writing an adapter for another CLI — the `write-a-cli-adapter` topic; direct provider calls — the `run-ai-agent` topic of the `warlock-js-ai` skill.'
---

# Run coding CLIs as agents

`@warlock.js/ai-cli` drives vendor coding CLIs headless. One run is one session. The vendor's stream is reduced to one event model, and `done()` resolves the final text, the usage and a session reference you can resume. It ships fourteen adapters: Claude Code, Codex, Antigravity, Qwen Code, Kimi Code, Cursor, Copilot, Grok Build, OpenCode, Amp, Factory Droid, Mistral Vibe, Aider and Reasonix. The CLIs themselves are not installed by the package.

## Run a prompt and read the events

```ts
import { cli } from "@warlock.js/ai-cli";

const claude = cli.claudeCode({ model: "sonnet", apiKey: process.env.ANTHROPIC_API_KEY });
const session = await claude.run("Fix the failing test in src/math.spec.ts", {
  cwd: "/srv/acme-api",
});

for await (const event of session.events) {
  switch (event.type) {
    case "session.started":
      console.log("session", event.sessionRef);
      break;
    case "message":
      if (event.delta) process.stdout.write(event.text);
      break;
    case "tool.call":
      console.log("\ntool", event.name, event.input);
      break;
    case "tool.result":
      console.log(event.isError ? "failed:" : "ok:", event.output.slice(0, 200));
      break;
    case "usage":
      console.log("tokens", event.usage.total);
      break;
    case "error":
      console.error(event.fatal ? "fatal:" : "warning:", event.message);
      break;
    case "session.ended":
      console.log("ended", event.status, event.exitCode);
      break;
  }
}

const result = await session.done();

if (result.status === "completed") {
  console.log(result.text, result.usage, result.sessionRef);
} else {
  console.error(result.status, result.error, result.stderr);
}
```

- **`session.events`** replays from the first event on every iteration, and ends after `session.ended`.
- **`done()` never rejects.** Branch on `status`: `completed`, `failed`, `cancelled` or `timeout`.
- **`text`** is the vendor's final record, or else the last assistant message. `messages` holds every complete message.
- **`run()` rejects only for setup problems,** with a `CliError` whose `type` is one of:
  - `not-found` — the executable is not on `PATH`;
  - `capability` — `--help` lacks a needed flag; the error carries `flag` and `version`;
  - `probe-failed` — the CLI's help could not be read;
  - `unsupported-option` — the adapter cannot honour an option;
  - `prompt-transport` — the prompt fits neither argv nor stdin.

`ai.cli` is the same namespace once `import "@warlock.js/ai-cli"` has run.

## Resume, cancel, time out

```ts
import { cli } from "@warlock.js/ai-cli";

const codex = cli.codex({ cwd: "/srv/acme-api" });
const plan = await (await codex.run("Plan the billing refactor; do not edit files")).done();

const controller = new AbortController();
const step = await codex.run("Implement step 1 of the plan", {
  resume: plan.sessionRef,
  signal: controller.signal,
  timeoutMs: 15 * 60_000,
});

setTimeout(() => controller.abort(), 60_000); // or step.cancel()

const outcome = await step.done();

console.log(outcome.status); // "cancelled" after the abort
```

Abort and timeout kill the whole process tree. On POSIX that is the CLI's process group (SIGTERM, then SIGKILL after `killGraceMs`, default 2000); on Windows it is `taskkill /T /F` on its PID. A run whose signal is already aborted never spawns.

## Permissions — bypass is opt-in

```ts
import { cli } from "@warlock.js/ai-cli";

// Default "standard": the CLI's own non-interactive rules; anything needing approval is refused.
const reviewer = cli.copilot({ cwd: "/srv/acme-api" });

// "bypass": every tool call approved without asking. Only for a sandboxed run.
const fixer = cli.grok({ cwd: "/sandbox/acme-api", permission: "bypass" });

const review = await (await reviewer.run("Review src/billing for bugs")).done();
const fix = await (
  await fixer.run("Apply the fixes from the review", { permission: "bypass" })
).done();

console.log(review.text, fix.status);
```

What `"standard"` allows depends on the vendor:

- **Read-only:** Codex and Droid. Allow edits with `args: ["-c", "sandbox_mode=workspace-write"]` (Codex) or `args: ["--auto", "medium"]` (Droid).
- **Permissive:** OpenCode and Amp.
- **Refused:** Kimi Code always approves in print mode, so its adapter rejects `"standard"` and needs `"bypass"`.

## MCP servers, secrets and homes

```ts
import { cli } from "@warlock.js/ai-cli";

const claude = cli.claudeCode({
  apiKey: process.env.ANTHROPIC_API_KEY, // exported as ANTHROPIC_API_KEY, never argv
  inheritEnv: ["GITHUB_TOKEN"], // minimal system env + these names only
});

const session = await claude.run("Triage the open issues", {
  mcp: {
    tracker: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@acme/tracker-mcp"],
      env: { TRACKER_TOKEN: process.env.TRACKER_TOKEN ?? "" },
    },
    docs: {
      type: "http",
      url: "https://mcp.acme.dev/mcp",
      headers: { Authorization: `Bearer ${process.env.DOCS_TOKEN ?? ""}` },
    },
  },
});

console.log((await session.done()).text);
```

**MCP servers.** They are written as a mode-0600 file inside a private per-run directory (mode 0700), never into argv, and the file is removed after the run. CLIs that read MCP only from their config home (Kimi, Grok, Cursor, Droid, Antigravity, Mistral Vibe, Reasonix) need the default private home. Aider has no MCP support.

**Homes.** The `home` option takes one of:

- `"private"` (default) — a fresh config home per run;
- an absolute path — a home you own, for example one you logged in to;
- `"inherit"` — your normal config.

The adapter's home variable (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, `GROK_HOME`, …) is pointed at it.

## Use a CLI as an `ai.agent` model

```ts
import { ai, budget } from "@warlock.js/ai";
import { cli } from "@warlock.js/ai-cli";

const coder = cli.codex({ cwd: "/srv/acme-api" });

const reviewer = ai.agent({
  model: coder.model({ name: "codex-reviewer" }),
  middleware: [budget({ maxTokens: 200_000 })],
});

const review = await reviewer.execute("Review the last commit for bugs.");

console.log(review.text, review.usage.total);
```

How the model behaves:

- **One fresh CLI session per call.** System messages lead the prompt, and a history is rendered as a transcript.
- **The CLI uses its own tools.** A call with agent `tools` is refused; give the CLI `mcp` servers instead.
- **Streaming yields the final answer once the session ends.**
- **A failed run throws `CliError` with `type: "run-failed"`,** so `fallbackModel` works.
- **Pass `pricing`** for USD cost.

## Pitfalls

- Install and log in to the vendor CLI yourself. With the default private home, authenticate with `apiKey`/`env`.
- `effort` is refused by CLIs without an effort control (Qwen Code, Kimi, Cursor, Mistral Vibe), and `model` is refused by Amp. Nothing is silently ignored.
- `args` is passed verbatim; never put a token there.
- The vendor table in the docs ("Vendor adapters") lists each CLI's flags, stream format, and the version it was verified against.
