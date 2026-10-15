---
description: "Policy-jailed filesystem and shell access for @warlock.js/ai agents, for coding and build-loop agents. Exports `workspace`, `makeEditFileTool`, `makeRunShellTool`, `makeRunTestsTool`, `createLocalBackend`, `createMockBackend`, `WorkspacePolicyError`. Use for: let an agent read, edit or write files, run shell commands or tests safely, sandbox an agent to a directory, build a coding agent that loops until tests pass, test file tools with a fake backend. Not this package: web, HTTP or MCP tools → @warlock.js/ai-tools; agents and custom tools → @warlock.js/ai; tracing runs → @warlock.js/ai-panoptic."
---
# @warlock.js/ai-workspace

A workspace is a policy jail around a directory: it decides which paths an agent may read or write and which shell commands may run, then exposes read, write, edit, glob, grep, shell and test tools bound to that policy. Importing the package registers `ai.workspace(...)` on the shared `ai` object.

## The 80% path
1. Create a workspace with a root and policy (`use-a-workspace.md`).
2. Hand its tools to an `ai.agent()`.
3. For a coding agent, follow the read → edit → run tests loop until green (`build-loop-agent.md`).

## Conventions and pitfalls
- The policy is the security boundary: keep the root narrow and the shell allowlist explicit; violations throw `WorkspacePolicyError`.
- Paths resolve inside the jail; escaping it via `..` or symlinks is rejected on purpose.
- The local backend runs real processes. Use `createMockBackend` in tests so no disk or shell is touched.
- Edits fail loudly (`WorkspaceEditError`) when the target text is not found; re-read the file rather than retrying blindly.
