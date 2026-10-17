# `@warlock.js/ai-workspace` — skills index

Per-task skills. Cross-references name the topic ("the `<topic>` topic"), and for another package add its skill ("the `<topic>` topic of the `warlock-js-<pkg>` skill").

## Skills

### `use-a-workspace`

Build a policy-jailed filesystem + shell workspace with `ai.workspace(policy)` and operate it from both ends — the agent-facing `ws.tools.*` (files, `list_dir`, `multi_edit`, `run_shell` with background commands, `shell_output` / `shell_kill`, `run_tests`, `grep`, `glob`, `todo_write` / `todo_read`, plus `all()` / `pick(...)`) and the human-facing direct methods (`readFile` / `writeFile` / `editFile` / `multiEdit` / `listDir` / `exec` / `startShell` / `shellOutput` / `shellKill` / `grep` / `glob` / `exists` / `mkdir` / `remove` / `readTodos` / `writeTodos` / `dispose`). Covers the policy surface (the `cwd` jail, `allowPaths` / `denyPaths`, the fail-closed shell allow/deny + `denyPatterns` / `allowCommand` + `inheritEnv`, the opt-in `interpreter: "sh"` shell mode and its refusal reasons, read caps, list bounds), the local vs mock backend, the read-before-edit stale-hash guard, the typed `WorkspacePolicyError` / `WorkspaceEditError`, and the `readonly()` / `scope(subdir)` projections. Load when constructing a workspace, choosing a policy, vending tools to an agent, or driving the filesystem programmatically.

### `build-loop-agent`

Wire a workspace into a coding agent that closes the read → edit → run-tests loop on its own — `ai.agent({ tools: ws.tools.all() })` so a failing suite comes back as tool _data_ and the model self-corrects until green. Covers the minimal build-loop wiring, why errors-as-data drives the loop, the shell policy a test command needs (`shell.allow` + `inheritEnv: ["PATH"]`), the read-only reviewer via `tools.pick` / `readonly()`, scaffolding from code before handing off, and sharing one jail across a supervisor's members. Load when building an agent that edits a repo, runs tests, reviews code, or scaffolds then hands off.
