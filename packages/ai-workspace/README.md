# @warlock.js/ai-workspace

> Policy-jailed filesystem + shell workspace for `@warlock.js/ai` agents.

A **workspace** is the bounded place an agent reads, writes, and runs commands — a
policy-enforced handle to a filesystem + shell that (a) vends tools to agents and
(b) you can drive directly from code. One policy, one shared rule set, two ways to
touch it: the agent uses `ws.tools.*`; you use the direct methods (`ws.readFile`,
`ws.exec`, …). Importing the package registers the verb on the shared `ai` object,
so it is reached as `ai.workspace(policy)` per the `ai.`-namespace convention.

## Security: a policy jail, not OS isolation

The workspace is a **policy jail**, and it is honest about that — it is **not** an
OS sandbox. Every path is `realpath`-resolved and must sit under `cwd` (or an
`allowPaths` root); `denyPaths` globs are blocked even inside `cwd`; shell commands
are gated by an executable allow/deny list; and `process.env` is **never** inherited
wholesale (a command can't even find `node`/`npm` unless the policy opts in via
`shell.inheritEnv: ["PATH"]`). What it does **not** do is contain what an _allowed_
process does once it runs — an allowed `node` can still open a socket or read a file
its own user can reach. Shell mode (`interpreter: "sh"`) is likewise a policy layer
checked before `/bin/sh` runs the line — defence in depth, not a sandbox. For an
untrusted agent, run the workspace inside a container or microVM with only the
project mounted, or at least as a separate unprivileged user, and keep this policy
as a second layer. Treat it as least-privilege guardrails for a **trusted** agent,
not a security boundary around a hostile one.

## Install

```bash
npm install @warlock.js/ai-workspace
```

It declares `@warlock.js/ai` as a peer and depends on `@warlock.js/fs`; beyond those
it uses only Node built-ins (`node:child_process` for the shell). Import the package
once for its side effect so `ai.workspace(...)` is registered:

```ts
import "@warlock.js/ai-workspace";
```

## Usage

### 1. Minimal build-loop agent

Hand the whole tool set to an agent and let it read, edit, and run tests until green.
The failure comes back as tool _data_, so the agent self-corrects.

```ts
import "@warlock.js/ai-workspace";
import { ai } from "@warlock.js/ai";

const ws = ai.workspace({
  cwd: "/srv/acme-api",
  denyPaths: [".git/**", ".env*"],
  shell: { allow: ["npm", "node"], inheritEnv: ["PATH"], timeoutMs: 60_000 },
});

const dev = ai.agent({
  model: ai.openai.model({ name: "gpt-4o" }),
  tools: ws.tools.all(),
  maxTrips: 25,
});

await dev.execute("`npm test` fails on the cart-total suite. Make it green.");
```

### 2. Read-only reviewer (least privilege via `tools.pick`)

A reviewer needs to read and search — never to write or run a shell. Pick exactly
those three tools, or take a `readonly()` projection (which omits every mutating tool
_and_ rejects the mutating direct methods).

```ts
const ws = ai.workspace({ cwd: "/srv/acme-api" });

const reviewer = ai.agent({
  model: ai.openai.model({ name: "gpt-4o" }),
  tools: ws.tools.pick("readFile", "grep", "glob"),
});

await reviewer.execute("Review src/cart for off-by-one bugs and summarize.");

// Equivalent, as a projection of the same jail:
const ro = ws.readonly();
ai.agent({ model, tools: ro.tools.all() }); // read_file, list_dir, grep, glob, todo tools
```

### 3. Direct programmatic use (no LLM)

Drive the workspace from code — scaffold before an agent runs, or do a mechanical
bulk migration under the read-before-edit stale-hash guard.

```ts
const ws = ai.workspace({
  cwd: "/srv/acme-api",
  shell: { allow: ["npm"], inheritEnv: ["PATH"] },
});

// Seed structure, install a dep, then hand off to an agent.
await ws.writeFile("src/routes.ts", ROUTES_BOILERPLATE);
await ws.exec("npm install zod");

// Bulk migration — no LLM needed.
for (const file of await ws.glob("src/models/**/*.ts")) {
  const { content, hash } = await ws.readFile(file);

  if (content.includes("legacyImport")) {
    await ws.editFile({
      path: file,
      oldString: 'import { legacyImport } from "../legacy";',
      newString: 'import { modernImport } from "../modern";',
      replaceAll: true,
      expectHash: hash, // rejected if the file moved underneath us
    });
  }
}
```

## What's in the package

- **Policy jail** — `cwd` path jail (`realpath`-resolved), `allowPaths` / `denyPaths`,
  a fail-closed shell allow/deny list (deny wins), argument rules (`denyPatterns`,
  `allowCommand`), per-command timeout + output cap, and opt-in `inheritEnv` (no
  blanket `process.env`).
- **argv by default, shell on request** — commands run as one argv without a shell;
  a refusal names the operator and suggests the split. `shell.interpreter: "sh"`
  opts in to pipes, `&&` and redirections, with every command in the line checked
  and redirections kept inside the jail.
- **Backends** — `local` (default; `@warlock.js/fs` + `node:child_process`) and
  `mock` (in-memory, for hermetic disk-free tests).
- **Tools** under `ws.tools.*` — `read_file`, `edit_file`, `multi_edit`, `apply_patch`, `write_file`,
  `list_dir`, `run_shell` (optionally in the background), `shell_output`,
  `shell_kill`, `run_tests`, `grep`, `glob`, `todo_write`, `todo_read` — each a
  `ToolContract` (with a JSON Schema of its input) ready for `ai.agent({ tools })`.
- **Direct methods** — `readFile` / `writeFile` / `editFile` / `multiEdit` / `applyPatch` /
  `listDir` / `exec` / `startShell` / `shellOutput` / `shellKill` / `listShells` /
  `grep` / `glob` / `exists` / `mkdir` / `remove` / `readTodos` / `writeTodos`,
  sharing the exact same policy seam, and `dispose()`.
- **Background commands** — with `shell.background`, dev servers and watchers run
  as jobs owned by the workspace, read incrementally, and are killed (whole process
  tree) by `shell_kill` or `dispose()`.
- **`tools.all()` / `tools.pick(...)`** — every tool, or a least-privilege subset.
- **`readonly()`** — a projection that vends only the read-side tools (read, list,
  grep, glob, todos) and rejects every mutating direct method.
- **`scope(subdir)`** — a sub-jailed view rooted at `subdir` (tighter blast radius).
- **Read-before-edit guard** — `read_file` returns a SHA-256 `hash`; `edit_file`
  requires an exact, unique `oldString` (or `replaceAll`) and rejects on an
  `expectHash` mismatch.
- **Bounded reads** — `read.maxBytes` caps the UTF-8 bytes a read returns (line
  numbers included), cutting on a character boundary and flagging `bytesCapped`;
  the `hash` still covers the whole file.
- **Cancellable commands** — `exec(cmd, { signal })`, and the agent run's signal
  in `run_shell` / `run_tests`, stop the command (process tree killed, or never
  started when already aborted) and report `cancelled: true`.

**Not in the package yet**: the transactional lifecycle (`snapshot` / `restore` /
`diff` / `changes`), `on()` hooks, `usage()`, and the worktree / container backends
plus provisioning helpers.

## Skills

Progressive-disclosure, per-task docs live under [`skills/`](./skills/index.md):

- [`use-a-workspace/`](./skills/use-a-workspace/SKILL.md) — build a jailed workspace
  and operate it (policy, tools, direct methods, `readonly` / `scope`).
- [`build-loop-agent/`](./skills/build-loop-agent/SKILL.md) — wire `ws.tools.all()`
  into a coding agent that reads → edits → runs tests until green.
