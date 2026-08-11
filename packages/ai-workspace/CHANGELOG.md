# Changelog — @warlock.js/ai-workspace

All notable changes to `@warlock.js/ai-workspace` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

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
