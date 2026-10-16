# Changelog — release tooling

## 5.31.0

### Fixed

- Release CI and local gate quality commands require real Redis integration specs; configured-port reporting tests mock availability checks and no longer need fixed ports free.

- Ratcheted strictness budgets to measured counts: AI 453, Core 41, Web 169, Auth 16, Cache 15, Scheduler 7, scaffolder 8 and Ollama 29. Indexed reads now retain proven bounds and test preconditions.
- Skill compilation resolves source subpaths and each owning package's installed dependencies, isolates application declaration merging between skills, and checks missing modules/registry leakage with compiler-backed controls.

- The release gate regenerates every package llms reference before public-text validation and clean-tree checks, so stale projections must be reviewed and committed before packing.

- Package-manager documentation exceptions match exact content and file instead of drifting line numbers, while replacement commands remain checked. CI now runs shipped-doc and skill-snippet gates; the new devtools skill starts with a measured zero-failure allowance.

- Origin install, scaffold and dependency checks retry within the same propagation deadline as registry views. Final failure preserves the runner's release commit in the uploaded logs as a Git bundle and prints artifact restoration, commit import, ancestry verification, branch/tag push and registry blog-check recovery steps.

- Origin confirmation retries registry propagation and read failures for thirty minutes with capped exponential backoff. The workflow uses this single window. Exhaustion prints origin-read, recorded-commit tag/push and registry blog-check recovery commands.

- CI and the release gate reject internal report identifiers and configured private application names anywhere in package and documentation sources, with file and line diagnostics.

- Restored a damaged historical locale-folder changelog entry and removed private application attribution from published package history and documentation. The public-text gate now rejects the additional configured name.

- Added exactly pinned Oxlint and Oxfmt workspace tools. Shared Oxlint correctness/suspicious checks run in CI in report-only mode during adoption; existing ESLint commands remain available.
