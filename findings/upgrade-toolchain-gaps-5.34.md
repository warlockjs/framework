# Upgrade and toolchain gaps found while upgrading an npm app to 5.33 (target 5.34)

Date: 2026-10-19 · Packages: @warlock.js/core (upgrade, updater), create-warlock · From: the 5.33 upgrade of a
production app (npm, `package-lock.json`, plus a `pnpm-workspace.yaml` used only for `allowBuilds` settings).

1. **Wrong install hint.** `warlock upgrade --json` reported `installHint: "pnpm install"` for an npm app.
   `detectPackageManager` (`src/updater/package-manager.ts`) ranks a `pnpm-workspace.yaml` marker above
   lockfiles, so a directory with `package-lock.json` and a `pnpm-workspace.yaml` but no `pnpm-lock.yaml` is
   detected as pnpm. At the same directory level, an existing lockfile should win over a workspace marker
   whose own lockfile is absent. Add a spec for that layout.
2. **The oxc-toolchain codemod drops custom lint rules.** For a customized `eslint.config.js` it writes the
   generic template `.oxlintrc.json` and only lists the old config as "port manually". Port what maps
   mechanically (per-folder `no-restricted-imports` blocks to `overrides`, `no-restricted-exports`,
   `@typescript-eslint/*` rules with Oxlint equivalents, `unused-imports/no-unused-imports`) and list only
   what cannot be ported (for example `no-restricted-syntax` selectors) as manual findings with the rule and
   files.
3. **Oxlint correctness rules are off.** The create-warlock oxc template and the codemod template set
   `"categories": { "correctness": "off" }` for parity with the old ESLint template, which enabled no
   recommended rules. With Oxlint as the only toolchain from 5.34, enable `correctness` (Oxlint's default; the
   monorepo already uses `"error"`) in new apps and in the codemod, with an Upgrading note.
