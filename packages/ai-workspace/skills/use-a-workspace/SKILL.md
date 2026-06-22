---
name: use-a-workspace
description: 'Build and operate a policy-jailed filesystem + shell workspace with @warlock.js/ai-workspace. Triggers: `ai.workspace`, `workspace(`, `WorkspacePolicy`, `WorkspaceShellPolicy`, `WorkspaceToolName`, `ws.tools.all`, `ws.tools.pick`, `ws.readFile`, `ws.writeFile`, `ws.editFile`, `ws.exec`, `ws.grep`, `ws.glob`, `ws.readonly`, `ws.scope`, `WorkspacePolicyError`, `WorkspaceEditError`, `denyPaths`, `inheritEnv`, `expectHash`, `read_file`/`edit_file`/`write_file`/`run_shell`/`run_tests`; ''give an agent file tools'', ''jail an agent to a directory'', ''let an agent read/write/grep a repo'', ''read-only workspace for a reviewer'', ''scope an agent to a subdirectory'', ''run a shell command under policy'', ''edit a file with a stale-hash guard''; typical import `import "@warlock.js/ai-workspace"; import { ai } from "@warlock.js/ai"`. Skip: building the agent loop that consumes the tools — `@warlock.js/ai-workspace/build-loop-agent/SKILL.md`; defining a non-filesystem custom tool — `@warlock.js/ai/define-ai-tool/SKILL.md`.'
---

# Use a workspace — a policy jail for an agent's filesystem + shell

`ai.workspace(policy)` returns a **workspace**: a bounded place an agent reads, writes, and runs commands. One policy, one shared rule set, two ways to touch it — the agent uses `ws.tools.*`; you use the direct methods. Import the package once for its side effect so the verb is registered on the shared `ai`:

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

Policy and edit failures are typed errors extending the `@warlock.js/ai` `AIError` base. Inside a tool the `tool()` wrapper catches them and surfaces them in `{ error }`, so the agent reads the failure and self-corrects. Branch on `.type`:

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
const ro = ws.readonly();         // vends only read/grep/glob; mutating direct methods reject
const api = ws.scope("packages/api"); // a sub-jailed workspace rooted at the subdir
```

`readonly()` is the least-privilege reviewer projection — `tools.all()` on it returns `read_file` + `grep` + `glob` only, and `writeFile` / `editFile` / `exec` / `mkdir` / `remove` throw a `WorkspacePolicyError`. `scope(subdir)` narrows `cwd` to `join(cwd, subdir)` (same sub-policies, same backend), so a per-package agent gets a tighter blast radius.

## Hermetic tests with the mock backend

`backend: "mock"` swaps the local disk for an in-memory `Map` + scripted `exec` — same policy, same tool/method surface, no filesystem:

```ts
const ws = ai.workspace({ cwd: "/srv/app", backend: "mock", shell: { allow: ["npm"] } });
// (Seed files / scripted commands via createMockBackend when constructing a backend directly.)
```

## See also

- [`@warlock.js/ai-workspace/build-loop-agent/SKILL.md`](@warlock.js/ai-workspace/build-loop-agent/SKILL.md) — wiring these tools into a read → edit → test agent loop.
- [`@warlock.js/ai/run-ai-agent/SKILL.md`](@warlock.js/ai/run-ai-agent/SKILL.md) — running the agent that consumes `ws.tools.all()`.
- [`@warlock.js/ai/define-ai-tool/SKILL.md`](@warlock.js/ai/define-ai-tool/SKILL.md) — the `tool()` / `ToolContract` seam every workspace tool is built on.
