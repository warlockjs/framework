---
title: "Use a workspace"
description: ai.workspace from @warlock.js/ai-workspace — a policy-jailed filesystem + shell for an agent, its tools (files, listing, multi-edit, shell with an opt-in interpreter and background commands, todos), direct methods, readonly, scope and dispose.
sidebar:
  order: 4
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

This is least-privilege guardrails for a **trusted** agent — not a sandbox around hostile code. It enforces a `realpath`-resolved `cwd` jail, path allow/deny, a fail-closed shell allow/deny list, timeouts, output caps, and a non-inherited environment. It does **not** contain what an _allowed_ process does once it runs. For an untrusted agent, run the workspace inside a container, a microVM or as a separate unprivileged user, and treat this policy as a second layer (see [Shell mode is a policy layer, not a sandbox](#shell-mode-is-a-policy-layer-not-a-sandbox)).

**How paths are jailed.** Every path is resolved against `cwd` with symlinks collapsed (`realpath` of the deepest existing ancestor), then accepted only inside `cwd` or an `allowPaths` root and off `denyPaths`. Absolute paths inside the jail, a symlinked `cwd`, links whose target stays inside, and paths that do not exist yet (for `writeFile` / `mkdir`) are all accepted. This is deliberately not `@warlock.js/fs`'s [confined reader](/v/latest/fs/guides/read-a-folder-confined/) (`fs.confined`), which refuses absolute paths and every link and only reads existing files: an app reading a folder it does not trust should use that reader; the workspace keeps its own resolver because its tools also write, run commands and honour several roots.

## The policy surface

| Field                                               | What it does                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`                                               | **Absolute** jail root. Every path resolves against it and must stay inside.                                                                                                                                                          |
| `allowPaths`                                        | Extra readable roots outside `cwd`.                                                                                                                                                                                                   |
| `denyPaths`                                         | Globs (`*`, `**`, `?`) blocked **even inside `cwd`** — e.g. `[".git/**", ".env*"]`. A bare dir name (`"node_modules"`) also blocks its contents.                                                                                      |
| `shell.allow` / `shell.deny`                        | Executable **basenames** matched against every command's argv (after tokenizing — see below). **Deny wins** and matches case-insensitively. An `allow` list is exhaustive (fail-closed); no `shell` block at all ⇒ nothing may run.   |
| `shell.denyPatterns` / `shell.allowCommand`         | Argument-level rules checked on every command: patterns such as `"git push --force"` or `/^rm -rf \//`, and a host predicate `(argv, ctx) => boolean \| string`. See [Argument rules](#argument-rules-denypatterns-and-allowcommand). |
| `shell.interpreter`                                 | `"none"` (default — argv, no shell) or `"sh"` (explicit opt-in to pipes, `&&`, redirections, still checked per command). See [Shell mode](#shell-mode-interpreter-sh).                                                                |
| `shell.background`                                  | Enables background commands (`run_shell({ background: true })`) with `{ maxJobs?, timeoutMs? }`. Absent ⇒ refused. See [Background commands](#background-commands).                                                                   |
| `shell.inheritEnv`                                  | Opt-in `process.env` keys to pass through (e.g. `["PATH"]`). **Nothing leaks in otherwise** — a command can't find `node`/`npm` without `PATH`.                                                                                       |
| `shell.env`                                         | Explicit env vars injected into every spawned process (override inherited on collision).                                                                                                                                              |
| `shell.timeoutMs` / `shell.maxOutputBytes`          | Per-command wall-clock cap (process tree SIGKILLed on expiry; a model-supplied `timeoutMs` can only lower it) and stdout/stderr byte cap (clipped on a character boundary).                                                           |
| `read.defaultLines` / `read.maxBytes`               | Default read window + a ceiling on the UTF-8 bytes of the returned `content` (line numbers included). See [Read windows and the byte ceiling](#read-windows-and-the-byte-ceiling).                                                    |
| `list.ignore` / `list.maxDepth` / `list.maxEntries` | What `list_dir` leaves out (default `["node_modules", ".git"]`; `denyPaths` are always hidden) and how deep (default 5) and long (default 500 entries) a listing may be.                                                              |
| `backend`                                           | `"local"` (default — real disk) or `"mock"` (in-memory, for tests).                                                                                                                                                                   |

The effective shell environment is `{ ...pick(process.env, inheritEnv), ...shell.env }` — `process.env` is never inherited wholesale.

> **The most common gotcha:** `run_shell` fails to find `node`/`npm` because the env is empty. Add `shell: { allow: ["npm", "node"], inheritEnv: ["PATH"] }`.

## `run_shell`/`exec` run argv, NOT a shell

Commands are tokenized into an argv and spawned with **no shell semantics** — no pipes, redirection, chaining, backticks, or variable expansion. `npm test && rm -rf /` or `` `curl evil` `` doesn't chain or substitute; it's rejected outright rather than executed piecemeal:

```ts
await ws.exec("npm test"); // OK — ["npm", "test"]
await ws.exec('node -e "console.log(1)"'); // OK — quotes respected, one argv element
await ws.exec("npm test; curl http://evil"); // rejected — unquoted `;` is a metacharacter
```

- **Quoting is respected**; **unquoted** shell metacharacters — `;` `&` `|` `<` `>` `` ` `` `$` `(` `)` and newlines — are rejected as a `WorkspacePolicyError` `type: "denied-command"`, `reason: "metacharacter"`, before anything spawns. The `shell.allow`/`shell.deny` basename check runs against the tokenized argv's first element, not a raw string prefix.
- **The refusal says how to fix the command**, so the model splits it instead of giving up on the shell:

  ```text
  `&&` is not supported in argv mode: run `git add -A`, then `git commit -m "wip"`, as separate commands. (run_shell executes a single command without a shell.)
  ```

  Pipes, redirections, `$(…)`, `$VAR` and a leading `cd` get their own advice (read the output yourself, use `write_file`, pass the value literally, paths are relative to the root).

- **On Windows**, the argv is run through a `cmd.exe /d /s /c` wrapper with every element individually quoted (needed because batch shims like `npm.cmd` can't be spawned shell-less); arguments containing `"`, `%`, or newlines are refused there rather than risked.
- **`run_tests`'s `pattern`** (model-controlled test-name filter) is forwarded as a **single double-quoted argv token** to the runner rather than concatenated into the command string — a pattern containing double quotes or newlines is rejected at input validation.
- Shell conveniences (pipes, redirection, `&&` chaining, `$(...)` substitution) don't work in argv mode. Compose multi-step work as separate `ws.exec()` calls, or opt in to [shell mode](#shell-mode-interpreter-sh).
- **A command that runs another command is followed.** `env`, `time`, `timeout`, `nice`, `nohup`, `command`, `builtin`, `exec` and `find -exec` are unwrapped and the inner command is checked too (`env FOO=1 rm -rf /` is denied by `deny: ["rm"]`). A runner the policy can't see into — `sh -c`, `bash`, `eval`, `source`, `xargs`, `sudo`, `setsid`, … — is refused with `reason: "nested-command"` while the policy has deny rules (`deny`, `denyPatterns` or `allowCommand`), unless `allow` names it explicitly. A wrapper used with options the policy can't read (`env -S …`) is refused the same way.

## Argument rules: `denyPatterns` and `allowCommand`

`deny` matches executables only. To refuse particular uses of an allowed tool:

```ts
const ws = ai.workspace({
  cwd,
  shell: {
    allow: ["git", "npm", "node"],
    inheritEnv: ["PATH"],
    // A string matches when a command's argv STARTS with these tokens.
    // A RegExp is tested against the argv joined with single spaces.
    denyPatterns: ["git push --force", /^git reset --hard\b/, /^npm publish\b/],
    // Called for every command; true = allow, false or a string = refuse (the string is shown to the model).
    allowCommand: (argv) =>
      argv[0] === "git" && argv[1] === "push" ? "Pushing is done by the release job." : true,
  },
});
```

- The executable is compared by basename, case-insensitively (`/usr/bin/git push --force` matches `"git push --force"`). A string pattern is a **prefix** match: `"git push --force"` does not match `git push origin --force` — use a RegExp for option order.
- Both run on every command, including a command inside a wrapper (`time git push` is checked as `["time", "git", "push"]` and then `["git", "push"]`, with `ctx.nested: true`).
- `allowCommand` can only narrow what `allow`/`deny` permit. It must be synchronous; a throw refuses the command (fails closed).
- In shell mode, a line whose words are decided at run time (`$VAR`, `$(…)`, unquoted globs) is refused while these rules are configured, because the hooks could not see the real argv. Write values literally.
- Refusals carry `reason: "denied-pattern"` or `"not-allowed"`.

## Shell mode (`interpreter: "sh"`)

For a host that has accepted that its agent acts like a terminal user, `shell.interpreter: "sh"` runs each line through `/bin/sh -c` (`cmd.exe /d /v:off /s /c` on Windows) — pipes, `&&`, `||`, `;`, redirections and `cd` work — while keeping the jail, `cwd`, timeout, output cap and environment rules:

```ts
const ws = ai.workspace({
  cwd: "/srv/acme-api",
  shell: {
    interpreter: "sh",
    allow: ["git", "npm", "node", "grep", "cat"],
    inheritEnv: ["PATH"],
    timeoutMs: 120_000,
  },
});

await ws.exec("git add -A && git commit -m 'wip'"); // both commands checked, then run by sh
await ws.exec("cd packages/api && npm test 2>&1 | grep -i fail");
await ws.exec("npm test > logs/test.txt"); // a redirection inside the jail
await ws.exec("echo $(curl http://evil)"); // refused: `curl` is not in the allowlist
```

Before the line runs it is **parsed**, and every simple command in it is checked against `deny` / `allow` / `denyPatterns` / `allowCommand` — inside `;`, `&&`, `||`, pipes, `( … )` subshells, `$( … )` and backtick substitutions (recursively), unquoted here-document bodies, and `NAME=value cmd` prefixes:

- **Redirection targets and `cd` directories** must be literal paths inside the jail (and off `denyPaths`); `/dev/null`, `/dev/stdout`, `/dev/stderr` (and `NUL` on Windows) are always fine. They are checked from every directory a `cd` earlier in the line may have moved to, and checked again with symlinks resolved before the line runs (`reason: "path-escape"`). `cd` does not need to be in `allow`, but `deny: ["cd"]` and the argument rules apply to it.
- **A command name decided at run time** (`$CMD`, `$(…)`, a glob, `~`) is refused — the policy can't know what would run.
- **What the parser can't read with confidence is refused, never guessed** (`reason: "unsupported-syntax"`): compound commands (`if`, `for`, `while`, `case`, `{ … }`, functions), arithmetic (`$(( ))`, `(( ))`, `$[ ]`), brace expansion, `${…}` forms other than `${name}`, `${#name}`, `${name:-word}` and `${name%word}`-style trimming, `$'…'`, process substitution, and bash-only redirections (`<<<`, `&>`, `|&`, `>&file`). Assigning `CDPATH`, `IFS`, `PS4`, `ENV`, `BASH_ENV`, `SHELLOPTS` and similar is refused, as are shell builtins whose arguments bash may evaluate as arithmetic (`test`, `printf -v`, `read`, `export`, …) when an argument is not literal or contains `[`.
- **`&` (background)** is refused in a line — start long-running commands with [`background: true`](#background-commands) so the workspace owns them.
- **Environment**: the variables that change how a shell starts or parses (`ENV`, `BASH_ENV`, `SHELLOPTS`, `BASHOPTS`, `CDPATH`, `IFS`, `PS4`, `GLOBIGNORE`, `BASH_FUNC_*`) are removed from the spawned environment.
- **Windows** parses a stricter `cmd.exe` subset: `&&`, `||`, `|`, `&` (sequential in cmd) and simple redirections; `%`, `!`, `^`, parentheses, `;` and `,` are refused.

> **Pair shell mode with an exhaustive `allow` list.** With only `deny`, the policy is a best-effort filter: an allowed program can still do anything it is able to (`node -e`, a build script). The jail is a guardrail for a trusted agent, not OS isolation.

### Shell mode is a policy layer, not a sandbox

Shell mode checks a command line **before** `/bin/sh` runs it. It is defence in depth: a parser that reads the line the way the shell will, and refuses what it cannot read. It is **not** an operating-system sandbox, and it cannot be one:

- `/bin/sh` differs between systems (bash, dash, busybox ash), and between versions of each. The parser refuses the constructs where they disagree, but a check that runs before the shell can never be stronger than the shell's own reading of the line.
- Once an allowed program runs, the policy no longer sees what it does. An allowed `node`, `npm`, `make` or `git` hook can start any process and touch any file the operating-system user can.
- Symlinked redirection targets are re-checked just before the line runs, but the filesystem can change between that check and the write.

For an agent you do not fully trust (one that reads untrusted repositories, issues, web pages or tool output), run the whole workspace under real OS isolation: a container or microVM with only the project mounted, or at least a separate unprivileged user that owns nothing else, without network access it does not need. Use the shell policy on top of that, never instead of it. Argv mode (`interpreter: "none"`, the default) gives the agent far less surface than shell mode; prefer it when the agent does not need pipes or redirections.

### Refusal reasons

Every shell refusal is a `WorkspacePolicyError` with `type: "denied-command"` and a structured `reason`, so a host can phrase it itself:

| `reason`               | Cause                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `"metacharacter"`      | argv mode met an unquoted operator; the message suggests the split                                   |
| `"unbalanced-quotes"`  | a quote (or `$(`, backtick, `${`) is never closed                                                    |
| `"denied-executable"`  | an executable is in `shell.deny` (`error.executable` names it)                                       |
| `"not-allowed"`        | not in `shell.allow`, refused by `allowCommand`, no shell policy, empty line, background not enabled |
| `"denied-pattern"`     | a command matched `shell.denyPatterns`                                                               |
| `"nested-command"`     | a command runner the policy can't see into, while deny rules are in force                            |
| `"unsupported-syntax"` | shell mode: syntax the parser does not read with confidence                                          |
| `"path-escape"`        | shell mode: a redirection target or `cd` directory outside the jail (`error.path` names it)          |

`checkShellCommand(policy, command)` returns the same verdict without running anything: `{ allowed, reason?, message?, executable?, path?, commands, paths }`.

## `grep` is ReDoS-bounded

The model supplies `pattern` freely, so `grep` treats it as untrusted input before compiling it into a `RegExp`: patterns over 200 characters and patterns matching a nested-quantifier shape (`(x+)+`, `(x*)*`, `(x+)*`, `(x*)+`-style groups — the classic catastrophic-backtracking shape) are rejected up front as a `WorkspacePolicyError` `type: "unsafe-pattern"`, before any regex is compiled. Any scanned line longer than 2000 characters is skipped (not tested), bounding the worst-case backtracking cost of any single call.

## Two callers, one jail

### Agent-facing — `ws.tools.*`

Each tool is a `ToolContract` ready for `ai.agent({ tools })`, and publishes a JSON Schema of its input so the provider sends the model the real parameter shape. The LLM-visible tool names are `read_file`, `edit_file`, `multi_edit`, `write_file`, `list_dir`, `run_shell`, `shell_output`, `shell_kill`, `run_tests`, `grep`, `glob`, `todo_write` and `todo_read`. `shell_output` / `shell_kill` are included in `all()` only when `shell.background` is set.

```ts
ws.tools.all(); // every tool, canonical order
ws.tools.pick("readFile", "grep", "glob"); // a least-privilege subset
ws.tools.readFile({ name: "open" }); // one tool, optionally renamed
ws.tools.runTests({ command: "pnpm test" }); // override the test base command
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
await ws.multiEdit({ path: "src/cart.ts", edits: [{ oldString: "a", newString: "b" }] });
const { entries, truncated } = await ws.listDir("src", { depth: 2 });
const job = await ws.startShell("npm run dev"); // needs shell.background
const { stdout, cursor, status } = await ws.shellOutput(job.id, { waitMs: 2_000 });
await ws.shellKill(job.id);
ws.writeTodos([{ content: "Fix the rounding bug", status: "in_progress" }]);
const { todos, counts } = ws.readTodos();
await ws.dispose(); // kills background commands; refuses new commands
```

## List a directory — `list_dir`

`list_dir({ path?, depth?, ignore? })` returns `{ path, entries, truncated }`: entries breadth-first, each level sorted by name, with `type` (`"file"`, `"directory"`, `"symlink"`, `"other"`), `size` for files and `depth` (1 = direct child). It is bounded — `depth` is capped by `list.maxDepth` (default 5) and the listing by `list.maxEntries` (default 500, then `truncated: true`) — and jailed: `denyPaths` are always left out, as are the `list.ignore` globs (default `node_modules`, `.git`) and any `ignore` globs the model passes. Ignored paths are hidden, not blocked: listing `node_modules` directly still works. Symlinks are reported, never followed.

## Several edits at once — `multi_edit`

`multi_edit({ path, edits: [{ oldString, newString, replaceAll? }, …], expectHash? })` applies up to 100 replacements to one file **atomically**: in order, each against the result of the previous ones, under the same rules as `edit_file` (`oldString` found, and unique unless `replaceAll`), then one write. If any edit fails, nothing is written and the `WorkspaceEditError` says which one (`editIndex`, and "Edit 2: …" in the message). `expectHash` rejects the whole call when the file changed since it was read. It returns `{ path, edits, replacements, hash }`.

## Background commands

Dev servers and watchers need to keep running while the agent works. Enable them with `shell.background`:

```ts
const ws = ai.workspace({
  cwd,
  shell: {
    allow: ["npm", "node"],
    inheritEnv: ["PATH"],
    background: { maxJobs: 2, timeoutMs: 30 * 60_000 },
  },
});
const dev = ai.agent({ model, tools: ws.tools.all() }); // includes shell_output + shell_kill
```

- `run_shell({ command, background: true })` checks the command like any other, starts it and returns at once with `{ background: true, id: "job-1", status: "running", pid, … }`.
- `shell_output({ id, since?, waitMs? })` returns `{ stdout, stderr, cursor, droppedBytes, truncated, status, exitCode, … }` — output produced since the previous read (or since `cursor` you pass as `since`). `waitMs` (max 30 s) waits for new output or for the command to stop. Only the newest `shell.maxOutputBytes` (default 1 MB) of each command's output is kept; `droppedBytes` says how much the reader missed.
- `shell_kill({ id })` kills the command's **whole process tree** and reports its final state (`"killed"`). States: `"running"`, `"exited"`, `"killed"`, `"timed-out"`.
- Background commands belong to the workspace, not to the agent run: cancelling the run does not stop them. **`ws.dispose()`** kills every one of them (whole trees) and makes the workspace refuse new commands; trees still running when the Node process exits are killed too. Call `dispose()` when the work is done.
- `maxJobs` (default 4) bounds how many run at once; `timeoutMs` (default none) kills one after that long, and a model-supplied `timeoutMs` can only lower it. Without `shell.background`, a background request is refused with `reason: "not-allowed"`.
- Only the processes the workspace started are ever signalled: on POSIX each command runs in its own process group and that group is killed; on Windows `taskkill /T` is run on the command's own PID.

## A todo list — `todo_write` / `todo_read`

Coding agents plan better with a visible checklist. `todo_write({ todos: [{ content, status, id? }, …] })` replaces the list with the complete updated one (`status`: `"pending"`, `"in_progress"`, `"completed"`; at most 100 items; missing ids become `"1"`, `"2"`, …); `todo_read({})` returns `{ todos, counts }`. The list lives in memory, one per workspace, shared by its `readonly()` and `scope()` projections — `ws.readTodos()` / `ws.writeTodos()` reach the same list from code.

## Read windows and the byte ceiling

`readFile()` and the `read_file` tool return the same result for the same arguments: a `cat -n` numbered window plus `{ startLine, endLine, totalLines, totalBytes, truncated, bytesCapped, hash }`.

- The window starts at `offset` (`startLine` on the tool) and holds at most `limit` lines (default `read.defaultLines`, else 2000).
- `read.maxBytes` caps the UTF-8 bytes of the returned `content` itself — line-number prefixes and newlines count. Whole lines are kept while they fit; the first line that doesn't is cut on a **character boundary** (never mid-character), so a single very long line still comes back bounded. `bytesCapped` is `true` whenever the cap cut anything, and `endLine` is the last line included, possibly partially.
- `truncated` is `true` when anything after `content` was withheld — later lines (by `limit`, the default window or the cap) or the tail of `endLine`.
- `hash` is always the SHA-256 of the **whole file**, not the window, so it is a valid `expectHash` whatever was returned. `totalBytes` is the whole file's size.
- No `maxBytes` ⇒ no byte cap (only the line window applies).
- `maxBytes` bounds what a read **returns**, not what it loads: the whole file is still read into memory and hashed, because `hash` covers the whole file. Keep very large files out of the jail with `denyPaths` if memory matters.

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

Writes, edits and removes of the **same path** run one after another, even when the agent dispatches several tool calls at once. Two `edit_file` calls pinned to the same `expectHash` therefore cannot both succeed: the second re-reads after the first has written and is rejected as stale, instead of silently overwriting it. Without `expectHash`, the second edit applies on top of the first. Different paths are not held up.

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

- `WorkspacePolicyError.type`: `"path-escape"` (jail escape / deny glob) | `"denied-command"` (the shell policy refused the line — see `reason` in [Refusal reasons](#refusal-reasons)) | `"unsafe-pattern"` (`grep` pattern too long or nested-quantifier ReDoS shape).
- `WorkspaceEditError.type`: `"not-found"` | `"not-unique"` | `"stale-hash"`; a `multiEdit` failure also sets `editIndex`.
- `WorkspaceJobError.type`: `"not-found"` (no background command with that id).

## Composition — `readonly()` and `scope()`

```ts
const ro = ws.readonly(); // vends only read/grep/glob; mutating direct methods reject
const api = ws.scope("packages/api"); // a sub-jailed workspace rooted at the subdir
```

`readonly()` is the least-privilege reviewer projection — `tools.all()` on it returns `read_file`, `list_dir`, `grep`, `glob` and the todo tools only, and `writeFile` / `editFile` / `multiEdit` / `exec` / `startShell` / `shellKill` / `mkdir` / `remove` throw a `WorkspacePolicyError`. Projections share the workspace's background commands and todo list; `dispose()` on any of them disposes the whole workspace. `scope(subdir)` narrows `cwd` to `join(cwd, subdir)` (same sub-policies, same backend), so a per-package agent gets a tighter blast radius:

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

A scripted command with `running: true` (`createMockBackend({ commands: { "npm run dev": { stdout: "ready\n", running: true } } })`) stays "running" as a background command until it is killed.

## See also

- [Use AI tools](/v/latest/ai/tools/use-ai-tools/) — the network/utility tool belt (web search, fetch, HTTP, calculator, date-time).
- [Connect MCP](/v/latest/ai/tools/connect-mcp/) — `ai.mcp.serve({ tools: () => ws.tools.all() }, ...)` publishes a workspace AS an MCP server.
- [Run supervisor](/v/latest/ai/orchestration/run-supervisor/) — coordinating the members that share one workspace.
- [Run agent](/v/latest/ai/agents/run-agent/) — the agent loop, `maxTrips`, and the run report.
