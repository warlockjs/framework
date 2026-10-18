# Changelog — release tooling

## 5.33.0 - 2026-10-19

### Fixed

- Always remove skill-snippet temporary files after collecting diagnostics, including failed runs; workspace toolchain tests ignore scratch directories and files without package manifests.

### Added

- Register the process supervisor as the 33rd lockstep family member, with local-registry coverage and zero strictness/skill-snippet allowances.

## 5.32.0 - 2026-10-18

### Fixed

- Preserve the configured source root during native declaration builds so imported workspace sources never receive generated declarations. Quality scripts and builds now refuse new untracked source files across the family and report the emitting command.
- The release runner forces `tsdown` 0.23.1 under pkgist (npm `overrides`), which brings `rolldown-plugin-dts` 0.28 — the first declaration plugin that supports TypeScript 7. With pkgist's own `tsdown` 0.22 range every member failed to build its `.d.mts` files on TypeScript 7 (`Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`). Remove the override once pkgist depends on `tsdown` ≥ 0.23.

### Security

- Refresh the npm lockfile to esbuild 0.28.2, past the Windows development-server advisory [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) (patched in 0.28.1).

### Changed

- Pin the native TypeScript compiler to 7.0.2 and typecheck with supported configuration options.
- Compile skill snippets with native `tsc`, retain skill-local aliases and dependency scopes, and parse JSONC without the removed compiler API. Resolve the strictness compiler through the package bin manifest.

## 5.31.0 - 2026-10-18

### Added

- `scripts/dispatch-release.ts` dispatches `release.yml` (gate or publish) with a token read from `WARLOCK_RELEASE_TOKEN_FILE`, follows the run, and on failure prints each failed job with its failed steps and annotations and saves the job logs under `release-logs/`; `--watch <runId>` follows an existing run. The release skill describes the full agent-driven release cycle.
- The zero-edit generator matrix has a generators row: a fresh scaffold with the test kit runs `warlock make endpoint --json` for a public and a guarded endpoint, is proved by the generated-output oracle (typecheck, development and production boot, new routes requested), then runs the generated tests with the app's own Vitest. It runs in every full matrix and with `--only generators`; a failed `make` report, a missing test or a failing generated test fails it.

### Fixed

- A tag or push that fails after origin confirmation now preserves the release commit bundle and prints recovery, as a failed confirmation already did. Recovery steps are also saved as `recover-release-v<version>.sh` in the uploaded logs; the script and the printed `( set -euo pipefail … )` block stop at the first failure without closing an interactive shell, and rerunning them after a partial tag or push keeps a tag already at the release commit.
- The public-text check scans git-tracked files, so local build output cannot produce false hits; it now also covers the deployed llms files under `docs/public` and matches internal identifiers case insensitively.
- The documentation tab guard covers every docs version and also fails when an npm, yarn or pnpm tab runs another package manager's command.
- Shared formatter config changes trigger standalone scaffolder checks; temporary coverage scratch output is ignored and its stale tracked snapshot removed.
- Skill compilation respects package export maps, so an existing internal source file cannot make an unpublished import appear valid. Page-test guidance includes both test and spec filenames.
- Documentation install tabs retain fenced commands after formatting, with a build guard against collapsed inline fences and focused Markdown/JSON regressions.
- Lowered skill compilation allowances to the measured 280 remaining failures and the AI Tools strictness allowance to 68 after final formatting, preserving every package's ratchet.
- Repository formatting uses one pinned Oxfmt configuration and a blocking CI check; generated outputs, locks and archives keep their own projection checks. Scaffolder source tests share the root formatter while generated-app templates retain their toolchain gates.
- Release CI and local gate quality commands require real Redis integration specs; configured-port reporting tests mock availability checks and no longer need fixed ports free.
- Shared Oxlint correctness checks now block CI errors while style warnings remain advisory. Removed dead bindings, preserved deliberate collection snapshots and documented precise exceptions for aggregation fields, test probes, control-character rejection and model method bindings.
- Ratcheted strictness budgets to measured counts: AI 453, Core 41, Web 169, Auth 16, Cache 15, Scheduler 7, scaffolder 8 and Ollama 29. Indexed reads now retain proven bounds and test preconditions.
- Skill compilation resolves source subpaths and each owning package's installed dependencies, isolates application declaration merging between skills, and checks missing modules/registry leakage with compiler-backed controls.
- The release gate regenerates every package llms reference before public-text validation and clean-tree checks, so stale projections must be reviewed and committed before packing.
- Package-manager documentation exceptions match exact content and file instead of drifting line numbers, while replacement commands remain checked. CI now runs shipped-doc and skill-snippet gates; the new devtools skill starts with a measured zero-failure allowance.
- Origin install, scaffold and dependency checks retry within the same propagation deadline as registry views. Final failure preserves the runner's release commit in the uploaded logs as a Git bundle and prints artifact restoration, commit import, ancestry verification, branch/tag push and registry blog-check recovery steps.
- Origin confirmation retries registry propagation and read failures for thirty minutes with capped exponential backoff. The workflow uses this single window. Exhaustion prints origin-read, recorded-commit tag/push and registry blog-check recovery commands.
- CI and the release gate reject internal report identifiers and configured private application names anywhere in package and documentation sources, with file and line diagnostics.
- Restored a damaged historical locale-folder changelog entry and removed private application attribution from published package history and documentation. The public-text gate now rejects the additional configured name.
- Added exactly pinned Oxlint and Oxfmt workspace tools; existing ESLint commands remain available.
