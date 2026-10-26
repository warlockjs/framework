# Workspace checks

`node scripts/check-public-text.mjs` (also `pnpm check:public-text`) scans the
git-tracked files under `packages/`, `docs/src/` and `docs/public/` (the deployed
llms files) for internal report identifiers and private application names, so
local build output (`esm/`, `cjs/`, `coverage/`, `.astro/`) never produces a hit.
Outside a git work tree it walks those directories instead, skipping dependency
directories and dist output. Configure the names in
`scripts/public-text.config.json`; matching is literal and case insensitive, for
identifiers as well as names. Binary files are excluded. Missing `packages/` or
`docs/src/` fails the check. Diagnostics name each file and line.
CI and the release gate both run this check before artifacts are built.

Run its regression tests with `node --test scripts/check-public-text.test.mjs`.

`releases/` (the family release summaries) is scanned too. `@warlock.js/core` ships
those summaries for `warlock release-notes`, but a package ships only paths inside its own root, so `packages/core/releases/` holds a copy.
`node scripts/sync-release-notes.mjs` refreshes it (`--check` fails on a difference,
and CI runs that), and the release gate syncs it before checking the working tree and
refuses a version with no `releases/<version>-summary.md`. Tests:
`node --test scripts/sync-release-notes.test.mjs`.

## Oxlint adoption

`pnpm lint:oxlint` runs the exact pinned Oxlint version with the root
`.oxlintrc.json`: correctness and suspicious rules plus TypeScript, import, React
and Unicorn plugins. All package lint commands use Oxlint; formatting uses Oxfmt.
CI reports this step without blocking while existing diagnostics are addressed;
remove `continue-on-error` when the repository has no errors. The normal root
script exits nonzero for errors, so it can become blocking without changing rules.
Type-aware linting is not enabled in this initial configuration; it requires a
separate matching native type-checker dependency and configuration.

See the [official Oxlint configuration reference](https://oxc.rs/docs/guide/usage/linter/config-file-reference)
for supported rules and categories. The configuration regression test runs the
real pinned binary against failing and clean TypeScript fixtures.
