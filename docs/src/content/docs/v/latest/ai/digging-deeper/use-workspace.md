---
title: "Use a workspace"
description: ai.workspace from @warlock.js/ai-workspace — a policy-jailed filesystem + shell for an agent, the seven tools, direct methods, readonly and scope.
sidebar:
  order: 11
  label: "Use a workspace"
---

`ai.workspace(policy)` returns a **workspace**: a bounded place an agent reads, writes, and runs commands. One policy, one shared rule set, two ways to touch it — the agent uses `ws.tools.*`, you use the direct methods. Ships in `@warlock.js/ai-workspace`; import the package once for its side effect so the verb registers on the shared `ai`.

```ts
import "@warlock.js/ai-workspace";
import { ai } from "@warlock.js/ai";

const ws = ai.workspace({
  cwd: "/srv/acme-api",
  denyPaths: [".git/**", ".env*"],
  shell: { allow: ["npm", "node"], inheritEnv: ["PATH"], timeoutMs: 60_000 },
  read: { defaultLines: 2_000 },
  backend: "local", // default; use "mock" for hermetic tests
});
```

> **Needs `@warlock.js/fs`.** The `"local"` backend runs over the real disk via `@warlock.js/fs` + `node:child_process` (a direct dependency of the package — no extra install). The `"mock"` backend needs nothing.

## A policy jail, NOT OS isolation

This is least-privilege guardrails for a **trusted** agent — not a sandbox around hostile code. It enforces a `realpath`-resolved `cwd` jail, path allow/deny, a fail-closed shell allow/deny list, timeouts, output caps, and a non-inherited environment. It does **not** contain what an *allowed* process does once it runs. Real isolation (container / microVM) is a later phase.

## The policy surface

| Field | What it does |
|---|---|
| `cwd` | **Absolute** jail root. Every path resolves against it and must stay inside. |
| `allowPaths` | Extra readable roots outside `cwd`. |
| `denyPaths` | Globs (`*`, `**`, `?`) blocked **even inside `cwd`** — e.g. `[".git/**", ".env*"]`. A bare dir name (`"node_modules"`) also blocks its contents. |
| `shell.allow` / `shell.deny` | Executable **basenames** matched against the command's leading token. **Deny wins.** An `allow` list is exhaustive (fail-closed); no `shell` block at all ⇒ nothing may run. |
| `shell.inheritEnv` | Opt-in `process.env` keys to pass through (e.g. `["PATH"]`). **Nothing leaks in otherwise** — a command can't find `node`/`npm` without `PATH`. |
| `shell.env` | Explicit env vars injected into every spawned process (override inherited on collision). |
| `shell.timeoutMs` / `shell.maxOutputBytes` | Per-command wall-clock cap (SIGKILL on expiry) and stdout/stderr byte cap. |
| `read.defaultLines` / `read.maxBytes` | Default read window + a byte ceiling. |
| `backend` | `"local"` (default — real disk) or `"mock"` (in-memory, for tests). |

The effective shell environment is `{ ...pick(process.env, inheritEnv), ...shell.env }` — `process.env` is never inherited wholesale.

> **The most common gotcha:** `run_shell` fails to find `node`/`npm` because the env is empty. Add `shell: { allow: ["npm", "node"], inheritEnv: ["PATH"] }`.

## Two callers, one jail

### Agent-facing — `ws.tools.*`

Each tool is a `ToolContract` ready for `ai.agent({ tools })`. The seven LLM-visible tool names are `read_file`, `edit_file`, `write_file`, `run_shell`, `run_tests`, `grep`, `glob`.

```ts
ws.tools.all();                              // all seven, canonical order
ws.tools.pick("readFile", "grep", "glob");   // a least-privilege subset
ws.tools.readFile({ name: "open" });          // one tool, optionally renamed
ws.tools.runTests({ command: "pnpm test" });  // override the test base command
```

`pick(...)` silently drops any name the projection does not allow, so a `readonly()` workspace can never be coaxed into vending a mutating tool.

```ts
const dev = ai.agent({
  model,
  tools: ws.tools.all(),
  maxTrips: 25,
});

await dev.execute("`npm test` fails on the cart-total suite. Make it green.");
```

### Human-facing — direct methods

The same policy seam, callable from code (no LLM):

```ts
const { content, hash, totalLines } = await ws.readFile("src/index.ts", { offset: 1, limit: 200 });
await ws.writeFile("src/new.ts", "export const x = 1;\n");
await ws.editFile({ path: "src/index.ts", oldString: "old", newString: "new", expectHash: hash });
const { exitCode, stdout, stderr, timedOut, truncated } = await ws.exec("npm test");
const { matches } = await ws.grep("TODO", { glob: "src/**/*.ts", ignoreCase: true });
const paths = await ws.glob("src/models/**/*.ts");
await ws.exists("package.json");
await ws.mkdir("src/generated");
await ws.remove("dist");
```

## Read-before-edit (the stale-hash guard)

`readFile` returns a SHA-256 `hash` of the full file. Pass it to `editFile`'s `expectHash`; if the file changed since you read it, the edit is rejected as stale so you re-read before clobbering. `editFile` also requires the `oldString` to be **exact and unique** — pass `replaceAll: true` to replace every occurrence, or include more surrounding context to disambiguate.

## Errors flow as data, not throws

Policy and edit failures are typed errors extending the `@warlock.js/ai` `AIError` base. Inside a tool the `tool()` wrapper catches them and surfaces them in `{ error }`, so the agent reads the failure and self-corrects. A failing test isn't an error at all — it's a normal result with `exitCode !== 0`, so the model reads the failure on the next trip. Branch on `.type`:

```ts
import { WorkspacePolicyError, WorkspaceEditError } from "@warlock.js/ai-workspace";

try {
  await ws.exec("rm -rf /");
} catch (error) {
  if (error instanceof WorkspacePolicyError && error.type === "denied-command") {
    console.warn(`Blocked: ${error.command}`);
  }
}
```

- `WorkspacePolicyError.type`: `"path-escape"` (jail escape / deny glob) | `"denied-command"`.
- `WorkspaceEditError.type`: `"not-found"` | `"not-unique"` | `"stale-hash"`.

## Composition — `readonly()` and `scope()`

```ts
const ro = ws.readonly();             // vends only read/grep/glob; mutating direct methods reject
const api = ws.scope("packages/api"); // a sub-jailed workspace rooted at the subdir
```

`readonly()` is the least-privilege reviewer projection — `tools.all()` on it returns `read_file` + `grep` + `glob` only, and `writeFile` / `editFile` / `exec` / `mkdir` / `remove` throw a `WorkspacePolicyError`. `scope(subdir)` narrows `cwd` to `join(cwd, subdir)` (same sub-policies, same backend), so a per-package agent gets a tighter blast radius:

```ts
const apiDev = ai.agent({ model, tools: ws.scope("packages/api").tools.all() });
const webDev = ai.agent({ model, tools: ws.scope("packages/web").tools.all() });
```

## Share one workspace across a team

One workspace is one jail and one tree. Pass it to several members of a supervisor, varying only the tool slice each gets — they all read/write the **same** files:

```ts
const ws = ai.workspace({ cwd, shell: { allow: ["npm", "node"], inheritEnv: ["PATH"] } });

ai.supervisor({
  members: [
    ai.agent({ /* executor */ model, tools: ws.tools.all() }),
    ai.agent({ /* reviewer */ model, tools: ws.readonly().tools.all() }),
    ai.agent({ /* tester   */ model, tools: ws.tools.pick("readFile", "runTests") }),
  ],
});
```

## Hermetic tests with the mock backend

`backend: "mock"` swaps the local disk for an in-memory `Map` + scripted `exec` — same policy, same tool/method surface, no filesystem:

```ts
const ws = ai.workspace({ cwd: "/srv/app", backend: "mock", shell: { allow: ["npm"] } });
// Seed files / scripted commands via createMockBackend when constructing a backend directly.
```

## See also

- [Use AI tools](../the-basics/use-ai-tools) — the network/utility tool belt (web search, fetch, HTTP, calculator, date-time).
- [Connect MCP](./connect-mcp) — `ai.mcp.serve({ tools: () => ws.tools.all() }, ...)` publishes a workspace AS an MCP server.
- [Run supervisor](./run-supervisor) — coordinating the members that share one workspace.
- [Run agent](../the-basics/run-agent) — the agent loop, `maxTrips`, and the run report.
