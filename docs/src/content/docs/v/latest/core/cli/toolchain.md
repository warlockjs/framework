---
title: Oxlint and Oxfmt toolchain
description: Default linting and formatting for applications and framework contributors in 5.33.
---

ESLint + Prettier are deprecated in 5.33.0 and will be removed in **5.34.0**.
New apps should use `--lint=oxc`. To migrate an existing app, install the new
core release and `ts-morph`, then run:

```bash
npx warlock upgrade --from 5.32 --to 5.33.0 --dry-run
npx warlock upgrade --from 5.32 --to 5.33.0
npm install
npm run format
npm run lint:check
npx warlock check
```

Review every reported `file:line`: customized configs are preserved and need
manual translation before removal. The codemod installs the template's Oxlint
and Oxfmt versions and pins TypeScript to 7.0.2. It replaces standard lint/format
scripts, removes legacy dependencies, and deletes only recognized generated
configs. A generated `.prettierignore` becomes `.oxfmtignore`. Existing Oxc
configs are preserved. `--dry-run --json` reports the same planned changes
without writing files.

## Framework contributors

From the repository root run `pnpm lint:oxlint` and `pnpm format:check`.
Package lint/fix and format scripts in Seal, Cascade, Herald, AI, Web and
create-warlock use the root Oxlint/Oxfmt configuration and binaries. Existing
legacy dependencies/configs remain for the 5.34 removal. The explicit
`format:prettier` and `format:prettier:check` compatibility scripts print a
deprecation warning; CI uses only the default Oxlint/Oxfmt scripts.
