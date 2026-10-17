---
name: use-a-workspace
description: 'Build and operate a policy-jailed filesystem + shell workspace with @warlock.js/ai-workspace. Triggers: `ai.workspace`, `workspace(`, `WorkspacePolicy`, `WorkspaceShellPolicy`, `WorkspaceToolName`, `ws.tools.all`, `ws.tools.pick`, `ws.readFile`, `ws.writeFile`, `ws.editFile`, `ws.exec`, `ws.grep`, `ws.glob`, `ws.readonly`, `ws.scope`, `ws.multiEdit`, `ws.listDir`, `ws.startShell`, `ws.shellOutput`, `ws.shellKill`, `ws.dispose`, `ws.readTodos`, `ws.writeTodos`, `WorkspacePolicyError`, `WorkspaceEditError`, `WorkspaceJobError`, `WorkspaceShellRefusalReason`, `checkShellCommand`, `denyPaths`, `denyPatterns`, `allowCommand`, `interpreter`, `shell.background`, `list.ignore`, `inheritEnv`, `expectHash`, `read.maxBytes`, `bytesCapped`, `cancelled`, `ExecOptions`, `tokenizeCommand`, `read_file`/`edit_file`/`multi_edit`/`write_file`/`list_dir`/`run_shell`/`shell_output`/`shell_kill`/`run_tests`/`grep`/`todo_write`/`todo_read`; ''give an agent file tools'', ''jail an agent to a directory'', ''let an agent read/write/grep a repo'', ''read-only workspace for a reviewer'', ''scope an agent to a subdirectory'', ''run a shell command under policy'', ''edit a file with a stale-hash guard'', ''command injection guard for an agent shell tool'', ''ReDoS-safe grep for an agent'', ''cap how many bytes a read returns'', ''cancel a running workspace command'', ''let the agent use pipes and &&'', ''why was my shell command refused'', ''deny git push --force'', ''run a dev server in the background'', ''atomic multi-edit'', ''list a directory for an agent'', ''todo list tool for an agent''; typical import `import "@warlock.js/ai-workspace"; import { ai } from "@warlock.js/ai"`. Skip: building the agent loop that consumes the tools — the `build-loop-agent` topic; defining a non-filesystem custom tool — the `define-ai-tool` topic of the `warlock-js-ai` skill.'
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

This is least-privilege guardrails for a **trusted** agent — not a sandbox around hostile code. It enforces a `realpath`-resolved `cwd` jail, path allow/deny, a fail-closed shell allow/deny list, timeouts, output caps, and a non-inherited environment. It does **not** contain what an _allowed_ process does once it runs. Real isolation (container / microVM) is a later phase.

## The policy surface

| Field                                               | What it does                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cwd`                                               | **Absolute** jail root. Every path resolves against it and must stay inside.                                                                                                                                             |
| `allowPaths`                                        | Extra readable roots outside `cwd`.                                                                                                                                                                                      |
| `denyPaths`                                         | Globs (`*`, `**`, `?`) blocked **even inside `cwd`** — e.g. `[".git/**", ".env*"]`. A bare dir name (`"node_modules"`) also blocks its contents.                                                                         |
| `shell.allow` / `shell.deny`                        | Executable **basenames** matched against every command's argv (after tokenizing — see below). **Deny wins**, case-insensitively. An `allow` list is exhaustive (fail-closed); no `shell` block at all ⇒ nothing may run. |
| `shell.denyPatterns` / `shell.allowCommand`         | Argument rules on every command: string prefix patterns (`"git push --force"`) or RegExps, and a predicate `(argv, ctx) => true \| false \| "why"`.                                                                      |
| `shell.interpreter`                                 | `"none"` (default, argv) or `"sh"` (opt-in shell syntax, every command checked).                                                                                                                                         |
| `shell.background`                                  | `{ maxJobs?, timeoutMs? }` — enables background commands. Absent ⇒ refused.                                                                                                                                              |
| `list.ignore` / `list.maxDepth` / `list.maxEntries` | `list_dir` bounds: hidden globs (default `node_modules`, `.git`), depth cap (5), entry cap (500).                                                                                                                        |
| `shell.inheritEnv`                                  | Opt-in `process.env` keys to pass through (e.g. `["PATH"]`). **Nothing leaks in otherwise** — a command can't find `node`/`npm` without `PATH`.                                                                          |
| `shell.env`                                         | Explicit env vars injected into every spawned process (override inherited on collision).                                                                                                                                 |
| `shell.timeoutMs` / `shell.maxOutputBytes`          | Per-command wall-clock cap (process tree SIGKILLed on expiry) and stdout/stderr byte cap (clipped on a character boundary).                                                                                              |
| `read.defaultLines` / `read.maxBytes`               | Default read window + a ceiling on the UTF-8 bytes of the returned `content` (line numbers included). See [Read windows and the byte ceiling](#read-windows-and-the-byte-ceiling).                                       |
| `backend`                                           | `"local"` (default — real disk) or `"mock"` (in-memory, for tests).                                                                                                                                                      |

> **The most common gotcha:** `run_shell` fails to find `node`/`npm` because the env is empty. Add `shell: { allow: ["npm", "node"], inheritEnv: ["PATH"] }`.

## `run_shell`/`exec` run argv, NOT a shell

Commands are tokenized (via `tokenizeCommand`) into an argv and spawned with **no shell semantics** — no pipes, redirection, chaining, backticks, or variable expansion. `npm test && rm -rf /` or `` `curl evil` `` doesn't chain or substitute; it's rejected outright rather than executed piecemeal:

```ts
await ws.exec("npm test"); // OK — ["npm", "test"]
await ws.exec('node -e "console.log(1)"'); // OK — quotes respected, one argv element
await ws.exec("npm test; curl http://evil"); // rejected — unquoted `;` is a metacharacter
```

- **Quoting is respected**; **unquoted** shell metacharacters — `;` `&` `|` `<` `>` `` ` `` `$` `(` `)` and newlines — are rejected as a `WorkspacePolicyError` `type: "denied-command"` before anything spawns. The `shell.allow`/`shell.deny` basename check runs against the tokenized argv's first element, not a raw string prefix, so a disguised leading token can't slip past the gate.
- **On Windows**, the argv is run through a `cmd.exe /d /s /c` wrapper with every element individually quoted (needed because batch shims like `npm.cmd` can't be spawned shell-less); arguments containing `"`, `%`, or newlines are refused there rather than risked (guards the BatBadBut-class argument-smuggling bug class).
- **`run_tests`'s `pattern`** (model-controlled test-name filter) is forwarded as a **single double-quoted argv token** to the runner, not concatenated into the command string — a pattern containing double quotes or newlines is rejected at input validation rather than passed through.
- Shell conveniences (pipes, redirection, `&&` chaining, `$(...)` substitution) don't work in argv mode. The refusal (`reason: "metacharacter"`) names the operator and suggests the split — e.g. "`&&` is not supported in argv mode: run `git add -A`, then `git commit -m "wip"`, as separate commands." — so the model retries correctly.
- **Wrappers are followed**: `env`, `time`, `timeout`, `nice`, `nohup`, `command`, `builtin`, `exec`, `find -exec` — the inner command is checked too. Runners the policy can't see into (`sh -c`, `bash`, `eval`, `source`, `xargs`, `sudo`, `setsid`, …) are refused with `reason: "nested-command"` while deny rules are in force, unless `allow` names them.

## Argument rules and shell mode

```ts
import { workspace, WorkspacePolicyError } from "@warlock.js/ai-workspace";

export async function commitWork(cwd: string) {
  const ws = workspace({
    cwd,
    shell: {
      interpreter: "sh", // opt in: pipes, &&, redirections — every command still checked
      allow: ["git", "npm", "grep"],
      denyPatterns: ["git push --force", /^git reset --hard\b/],
      allowCommand: (argv) => (argv[0] === "git" && argv[1] === "push" ? "CI pushes." : true),
      inheritEnv: ["PATH"],
      timeoutMs: 120_000,
    },
  });

  try {
    await ws.exec("git add -A && git commit -m 'wip'");
    return await ws.exec("npm test 2>&1 | grep -i fail > logs/failures.txt");
  } catch (error) {
    if (error instanceof WorkspacePolicyError && error.type === "denied-command") {
      console.warn(error.reason, error.message); // e.g. "denied-pattern", "path-escape"
    }

    throw error;
  }
}
```

- Shell mode parses the line and checks every simple command — inside `;`, `&&`, `||`, pipes, `( )`, `$( )`, backticks, here-documents and `NAME=value cmd` prefixes. Redirection targets and `cd` directories must be literal paths inside the jail (`/dev/null` is fine), re-checked with symlinks resolved.
- It refuses what it can't parse with confidence (`reason: "unsupported-syntax"`): compound commands, arithmetic, brace expansion, unusual `${…}` forms, bash-only redirections, a command name decided at run time, `&` in a line (use `background: true`), assignments to `IFS`/`PS4`/`CDPATH`/`BASH_ENV`…; it drops shell start-up variables (`ENV`, `BASH_ENV`, `SHELLOPTS`, `BASH_FUNC_*`, …) from the environment.
- `reason` values: `"metacharacter"`, `"unbalanced-quotes"`, `"denied-executable"`, `"not-allowed"`, `"denied-pattern"`, `"nested-command"`, `"unsupported-syntax"`, `"path-escape"`. `checkShellCommand(policy, line)` returns the verdict without running anything.
- Pair shell mode with an exhaustive `allow`: `deny` alone is a best-effort filter.

## Two callers, one jail

### Agent-facing — `ws.tools.*`

Each tool is a `ToolContract` (with a JSON Schema of its input) ready for `ai.agent({ tools })`. The LLM-visible tool names are `read_file`, `edit_file`, `multi_edit`, `write_file`, `list_dir`, `run_shell`, `shell_output`, `shell_kill`, `run_tests`, `grep`, `glob`, `todo_write`, `todo_read` — `shell_output` / `shell_kill` only in `all()` when `shell.background` is set.

```ts
ws.tools.all(); // every tool, canonical order
ws.tools.pick("readFile", "grep", "glob"); // a least-privilege subset
ws.tools.readFile({ name: "open" }); // one tool, optionally renamed
ws.tools.runTests({ command: "vitest run" }); // override the test base command
```

### Human-facing — direct methods

The same policy seam, callable from code (no LLM):

```ts
const { content, hash, totalLines, endLine, truncated, bytesCapped } = await ws.readFile(
  "src/index.ts",
  { offset: 1, limit: 200 },
);
await ws.writeFile("src/new.ts", "export const x = 1;\n");
await ws.editFile({ path: "src/index.ts", oldString: "old", newString: "new", expectHash: hash });
const { exitCode, stdout, stderr, timedOut, cancelled, truncated } = await ws.exec("npm test");
const { matches } = await ws.grep("TODO", { glob: "src/**/*.ts", ignoreCase: true });
const paths = await ws.glob("src/models/**/*.ts");
await ws.exists("package.json");
await ws.mkdir("src/generated");
await ws.remove("dist");
```

## The coding-agent tool belt

```ts
import { workspace } from "@warlock.js/ai-workspace";

export async function devLoop(cwd: string) {
  const ws = workspace({
    cwd,
    list: { maxEntries: 300 },
    shell: { allow: ["npm", "node"], inheritEnv: ["PATH"], background: { maxJobs: 2 } },
  });

  try {
    const { entries } = await ws.listDir("src", { depth: 2 }); // bounded, jailed, node_modules/.git hidden
    console.info(entries.map((entry) => `${entry.type} ${entry.path}`));

    const { hash } = await ws.readFile("src/cart.ts");
    await ws.multiEdit({
      path: "src/cart.ts",
      expectHash: hash,
      edits: [
        { oldString: "let total = 0;", newString: "let total = 0n;" },
        { oldString: "total += price;", newString: "total += BigInt(price);" },
      ], // all apply, or none (WorkspaceEditError.editIndex names the failing one)
    });

    const server = await ws.startShell("npm run dev"); // run_shell({ command, background: true })
    const { stdout, cursor } = await ws.shellOutput(server.id, { waitMs: 5_000 });
    console.info(stdout, cursor); // pass `since: cursor` to read only what comes next
    await ws.shellKill(server.id); // kills the whole process tree

    ws.writeTodos([{ content: "Fix the rounding bug", status: "completed" }]); // todo_write
    return ws.readTodos().counts; // todo_read
  } finally {
    await ws.dispose(); // kills every background command; the workspace refuses new commands
  }
}
```

- `list_dir({ path?, depth?, ignore? })` → `{ path, entries: [{ path, type, size?, depth }], truncated }`; `denyPaths` always hidden, `list.ignore` (default `node_modules`, `.git`) hidden from listings, symlinks reported but never followed.
- `multi_edit({ path, edits, expectHash? })` → `{ path, edits, replacements, hash }`; same uniqueness rules as `edit_file`, at most 100 edits.
- Background: `shell_output({ id, since?, waitMs? })` → `{ stdout, stderr, cursor, droppedBytes, truncated, status, exitCode }`; only the newest `shell.maxOutputBytes` per command are kept. States `"running"`, `"exited"`, `"killed"`, `"timed-out"`. Unknown id → `WorkspaceJobError`. Background commands outlive the agent run; `dispose()` (or process exit) kills them. Only processes the workspace spawned are ever signalled.
- Todos: one in-memory list per workspace, shared with `readonly()` / `scope()`; `todo_write` replaces the whole list (≤ 100 items, status `pending` / `in_progress` / `completed`).
- `run_shell`'s model-supplied `timeoutMs` can only lower `shell.timeoutMs`.

## `grep` is ReDoS-bounded

The model supplies `pattern` freely, so `grep` treats it as untrusted input before compiling it into a `RegExp`: patterns over 200 characters and patterns matching a nested-quantifier shape (`(x+)+`, `(x*)*`, `(x+)*`, `(x*)+`-style groups — the classic catastrophic-backtracking shape) are rejected up front as a `WorkspacePolicyError` `type: "unsafe-pattern"`, before any regex is compiled. Any scanned line longer than 2000 characters is skipped (not tested), bounding the worst-case backtracking cost of any single call regardless of pattern shape.

## Read windows and the byte ceiling

`readFile()` and the `read_file` tool return the same result for the same arguments: a `cat -n` numbered window plus `{ startLine, endLine, totalLines, totalBytes, truncated, bytesCapped, hash }`.

- The window starts at `offset` (`startLine` on the tool) and holds at most `limit` lines (default `read.defaultLines`, else 2000).
- `read.maxBytes` caps the UTF-8 bytes of the returned `content` itself — line-number prefixes and newlines count. Whole lines are kept while they fit; the first line that doesn't is cut on a **character boundary** (never mid-character), so a single very long line still comes back bounded. `bytesCapped` is `true` whenever the cap cut anything, and `endLine` is the last line included, possibly partially.
- `truncated` is `true` when anything after `content` was withheld — later lines (by `limit`, the default window or the cap) or the tail of `endLine`.
- `hash` is always the SHA-256 of the **whole file**, not the window, so it is a valid `expectHash` whatever was returned. `totalBytes` is the whole file's size.
- No `maxBytes` ⇒ no byte cap (only the line window applies).

```ts
const ws = ai.workspace({ cwd, read: { maxBytes: 64_000, defaultLines: 400 } });
const page = await ws.readFile("dist/bundle.js");
if (page.bytesCapped) console.warn(`Only part of line ${page.endLine} fit in the read budget.`);
```

## Cancelling a command

`exec()` accepts a per-call `signal`; `run_shell` and `run_tests` pass the agent run's signal (the dispatch `ctx.signal`) automatically, so cancelling the agent run stops the command it is waiting on.

- Already aborted ⇒ the command is **not started** (`exitCode: 130`).
- Aborted mid-run ⇒ the whole process tree is SIGKILLed, as on a timeout.
- Either way the result says `cancelled: true` — it resolves, it doesn't throw — and `cancelled` and `timedOut` are never both `true`. Branch on those flags, not on the exit code.
- The signal belongs to that one call; the workspace never stores it, so one workspace can serve many runs. The abort listener is removed once the command settles.

```ts
const controller = new AbortController();
const pending = ws.exec("npm test", { signal: controller.signal, timeoutMs: 120_000 });
controller.abort();
const { cancelled } = await pending; // true
```

A custom `WorkspaceBackend` receives the signal as `exec(command, { signal })` and should follow the same rules, reporting `cancelled: true` in its result.

## Read-before-edit (the stale-hash guard)

`readFile` returns a SHA-256 `hash` of the full file. Pass it to `editFile`'s `expectHash`; if the file changed since you read it, the edit is rejected as stale so you re-read before clobbering. `editFile` also requires the `oldString` to be **exact and unique** — pass `replaceAll: true` to replace every occurrence, or include more surrounding context to disambiguate.

Writes, edits and removes of the same path run one after another, even when the agent dispatches tool calls concurrently: of two edits pinned to the same `expectHash`, the second is rejected as stale instead of silently overwriting the first. `read.maxBytes` bounds what a read returns, not memory — the whole file is still read and hashed.

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

- `WorkspacePolicyError.type`: `"path-escape"` (jail escape / deny glob) | `"denied-command"` (the shell policy refused the line — `reason` says why) | `"unsafe-pattern"` (`grep` pattern too long or nested-quantifier ReDoS shape).
- `WorkspaceEditError.type`: `"not-found"` | `"not-unique"` | `"stale-hash"` (+ `editIndex` for `multiEdit`).
- `WorkspaceJobError.type`: `"not-found"` (unknown background command id).

## Composition — `readonly()` and `scope()`

```ts
const ro = ws.readonly(); // vends only read/grep/glob; mutating direct methods reject
const api = ws.scope("packages/api"); // a sub-jailed workspace rooted at the subdir
```

`readonly()` is the least-privilege reviewer projection — `tools.all()` on it returns `read_file`, `list_dir`, `grep`, `glob` and the todo tools only, and `writeFile` / `editFile` / `multiEdit` / `exec` / `startShell` / `shellKill` / `mkdir` / `remove` throw a `WorkspacePolicyError`. Projections share the workspace's background commands and todo list. `scope(subdir)` narrows `cwd` to `join(cwd, subdir)` (same sub-policies, same backend), so a per-package agent gets a tighter blast radius.

## Hermetic tests with the mock backend

`backend: "mock"` swaps the local disk for an in-memory `Map` + scripted `exec` — same policy, same tool/method surface, no filesystem:

```ts
const ws = ai.workspace({ cwd: "/srv/app", backend: "mock", shell: { allow: ["npm"] } });
// (Seed files / scripted commands via createMockBackend when constructing a backend directly.)
```

## See also

- The `build-loop-agent` topic — wiring these tools into a read → edit → test agent loop.
- The `run-ai-agent` topic of the `warlock-js-ai` skill — running the agent that consumes `ws.tools.all()`.
- The `define-ai-tool` topic of the `warlock-js-ai` skill — the `tool()` / `ToolContract` seam every workspace tool is built on.

## Complete bounded-read and cancellation example

```ts
import { workspace } from "@warlock.js/ai-workspace";

export async function inspectWorkspace(cwd: string) {
  const ws = workspace({
    cwd,
    read: { maxBytes: 64_000, defaultLines: 400 },
    shell: { allow: ["node"], inheritEnv: ["PATH"] },
  });
  const page = await ws.readFile("package.json");
  console.info(page.bytesCapped, page.endLine, page.hash);

  const controller = new AbortController();
  controller.abort();
  const result = await ws.exec('node -e "console.log(1)"', { signal: controller.signal });
  if (result.cancelled) console.info("Command cancelled before it started");
  return page;
}
```

The caller supplies an absolute existing workspace root. The already-aborted
signal demonstrates the no-spawn path; a later abort also kills a running
command's process tree. The byte ceiling limits returned content, while the
hash still describes the whole file.
