# WR-010: Per-invocation workspace command cancellation

Package: `@warlock.js/ai-workspace` 5.29.0.

This is a feature request based on the installed public contract, not a claimed
broken cancellation promise. `WorkspaceBackendExecOptions` provides `cwd`,
`timeoutMs` and `env` but no `AbortSignal`; `WorkspaceBackend.exec()` and the
ops/tool forwarding path do not expose invocation cancellation to the backend.
A timeout is available, while an already running reviewed test command cannot
receive the enclosing agent's cancellation through that public seam.

Request: thread a per-invocation signal from tool execution through ops to backend
execution, with defined pre-aborted behavior, owned process-tree teardown,
listener cleanup and cancellation-versus-timeout results. Do not cache the signal
in a reusable workspace shared across runs.

The API coding profile is implementing a per-call backend adapter with explicit
owned cancellation. Its actual process teardown must pass separate acceptance;
this report does not claim a runtime cancellation leak has been reproduced.
Source: `esm/contracts/workspace-backend.contract.d.mts` and
`esm/ops.mjs`, execution forwarding.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
