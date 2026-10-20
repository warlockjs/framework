---
description: 'Policy-confined file and shell tools for coding agents: `workspace`, `createLocalBackend`, `createMockBackend`, `makeEditFileTool`, `makeRunShellTool` and `WorkspacePolicyError`. Use for "let an agent edit files", "sandbox shell commands" or "loop until tests pass". Not this package → @warlock.js/ai-tools for MCP/web tools; @warlock.js/ai for agents; @warlock.js/ai-cli for installed coding CLIs.'
---

# @warlock.js/ai-workspace

A workspace is a policy jail around a directory: it decides which paths an agent may read or write and which shell commands may run, then exposes read, write, edit, multi-edit, list, glob, grep, shell (argv by default, opt-in `sh`, background commands), test and todo tools bound to that policy. Importing the package registers `ai.workspace(...)` on the shared `ai` object.

## The 80% path

1. Create a workspace with a root and policy (`use-a-workspace.md`).
2. Hand its tools to an `ai.agent()`.
3. For a coding agent, follow the read → edit → run tests loop until green (`build-loop-agent.md`).

## Conventions and pitfalls

- The policy is the security boundary: keep the root narrow and the shell allowlist explicit; violations throw `WorkspacePolicyError`.
- Paths resolve inside the jail; escaping it via `..` or symlinks is rejected on purpose.
- The local backend runs real processes. Use `createMockBackend` in tests so no disk or shell is touched.
- Shell refusals carry a `reason` and a message that says how to split the command; `interpreter: "sh"` is an explicit opt-in that still checks every command in the line.
- Call `ws.dispose()` when done: it kills background commands (whole process trees).
- Edits fail loudly (`WorkspaceEditError`) when the target text is not found; re-read the file rather than retrying blindly.
