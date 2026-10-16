# Workspace checks

`node scripts/check-public-text.mjs` (also `pnpm check:public-text`) scans
`packages/` and `docs/src/` for internal report identifiers and private application
names. Configure the names in `scripts/public-text.config.json`; matching is literal
and case insensitive. Dependency directories, dist output and binary files are
excluded. Missing scan roots fail the check. Diagnostics name each file and line.
CI and the release gate both run this check before artifacts are built.

Run its regression tests with `node --test scripts/check-public-text.test.mjs`.
