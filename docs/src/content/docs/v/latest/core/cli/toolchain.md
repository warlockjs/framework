---
title: Oxlint and Oxfmt toolchain
description: Linting, formatting and migration to the only supported toolchain in 5.34.
---

Oxlint **1.88.0** and Oxfmt **0.73.0** are the only supported tools. New apps
pin TypeScript **7.0.2** and include `.oxlintrc.json`, `.oxfmtrc.json`,
`.oxfmtignore`, and VS Code settings for `oxc.oxc-vscode`.
`--lint=oxc` is optional; `--lint=eslint` fails with the 5.34.0 removal message.
The wizard has no toolchain choice.

```bash
npm create warlock@latest my-app -- --yes
cd my-app
npm run lint:check
npm run format:check
```

Oxlint enables `"categories": { "correctness": "error" }`, unused-variable/import
checks, explicit class accessibility and type-import style. Oxfmt sorts imports
with `"sortImports": { "newlinesBetween": false, "internalPattern": ["app/", "web/", "@shared/"] }`.
It keeps built-ins, packages, internal aliases and relative imports in one block.
Formatting retains unused imports; lint reports them. Local package scripts use
`oxlint`, `oxfmt` and `tsc` directly. The non-mutating scripts are `lint:check`
and `format:check`. Background checks run TypeScript and configured Oxlint.

## Migrate existing apps

ESLint and Prettier support was removed in **5.34.0**. Oxlint/Oxfmt is the only
supported toolchain. `--lint eslint` and `healthCheckers.eslint` are removed.
Install the new core release and `ts-morph`, then migrate an existing app:

```bash
npm install --save-dev ts-morph
npx warlock upgrade --from 5.33 --to 5.34.0 --dry-run
npx warlock upgrade --from 5.33 --to 5.34.0
npm install
npm run format
npm run lint:check
npx warlock check
```

The `oxc-toolchain-removal` step reapplies the preserved 5.33 `oxc-toolchain`
migration when legacy configs, scripts or dependencies remain. Apps upgrading
from 5.32 can still use `npx warlock upgrade --from 5.32 --to 5.33.0` first.
It replaces standard scripts/dependencies, pins TypeScript 7.0.2, updates generated
editor settings, removes `healthCheckers.eslint` and selects Oxlint. A generated
`.prettierignore` becomes `.oxfmtignore`; Oxfmt scripts read it explicitly.

Literal custom rules are translated without executing the config. Per-folder
`no-restricted-imports` and `no-restricted-exports` become Oxlint overrides with
file/exclusion patterns. Supported `@typescript-eslint/*` rules become native
`typescript/*` rules (or native base rules). Options are checked against the
pinned Oxlint 1.88.0 schema. Type-aware equivalents enable `options.typeAware`
and add `oxlint-tsgolint@7.0.2004` to the app's dev dependencies.
`unused-imports/no-unused-imports` uses `no-unused-vars` with safe import fixes;
Oxlint shares the severity for imports and variables, so differing active
severities are reported for review.

Only unsupported rules/options, computed or imported settings, selectors such
as `no-restricted-syntax`, and conflicting existing Oxc rules need manual review.
Each finding names its source `file:line`, rule and affected file patterns.
Fully ported lint configs are removed; configs with findings remain for reference
until those findings are addressed. Existing Oxc rules are kept on conflict.
`--dry-run --json` reports the same plan without writes. Customized formatting,
editor settings and nonstandard scripts can also require review.

**Upgrading:** new and migrated template configs enable
`"categories": { "correctness": "error" }`. Address the additional diagnostics;
existing Oxc configs retain their categories. A real lockfile beside a workspace
marker determines the installer: `package-lock.json` plus `pnpm-workspace.yaml`
without `pnpm-lock.yaml` now produces `npm install`.

## Framework contributors

From the repository root, run `npm run lint:oxlint` and `npm run format:check`.
Package scripts use the root Oxlint/Oxfmt configuration. Legacy dependencies,
configs and compatibility scripts have been removed.
