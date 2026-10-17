# WR-042 — `ai-workspace`: the missing coding-agent tools

- **Package:** `@warlock.js/ai-workspace` 5.30.0
- **Classification:** feature request
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

There are 7 tools: `read_file`, `edit_file`, `write_file`, `run_shell`, `run_tests`, `grep` and `glob`. Compared with what coding agents rely on, these are missing:
- a directory listing (glob only);
- atomic multi-edit;
- background processes: dev servers, watchers, reading their output later, stopping them;
- a todo/plan tool;
- an opt-in shell mode for pipes and `&&`. Argv-only is the right default.

## Request

- `list_dir` with depth, ignore rules and sizes.
- `multi_edit`: several exact replacements in one file, atomic, checked by one `expectHash`.
- `run_shell({ background: true })` returning an id, plus `shell_output(id, { since })` and `shell_kill(id)`. Processes belong to the workspace and are killed when it is disposed.
- `todo_write` / `todo_read`, scoped to the run.
- `shell: { mode: "argv" | "shell" }`, where shell mode is explicit, still policy-checked per command segment, and off by default.

## Related (2026-10-17)

The shell policy matches executable basenames only, so it cannot deny argument patterns such as `rm -rf /` or
`git push --force`. Request: `shell.denyPatterns`, or an argv predicate `shell.allowCommand(argv) => boolean | string`.
