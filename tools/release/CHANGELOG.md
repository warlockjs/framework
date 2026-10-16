# Changelog — release tooling

## 5.31.0

### Fixed

- Origin install, scaffold and dependency checks retry within the same propagation deadline as registry views. Final failure preserves the runner's release commit in the uploaded logs as a Git bundle and prints artifact restoration, commit import, ancestry verification, branch/tag push and registry blog-check recovery steps.

- Origin confirmation retries registry propagation and read failures for thirty minutes with capped exponential backoff. The workflow uses this single window. Exhaustion prints origin-read, recorded-commit tag/push and registry blog-check recovery commands.

- CI and the release gate reject internal report identifiers and configured private application names anywhere in package and documentation sources, with file and line diagnostics.

- Restored a damaged historical locale-folder changelog entry and removed private application attribution from published package history and documentation. The public-text gate now rejects the additional configured name.

- Added exactly pinned Oxlint and Oxfmt workspace tools. Shared Oxlint correctness/suspicious checks run in CI in report-only mode during adoption; existing ESLint commands remain available.
