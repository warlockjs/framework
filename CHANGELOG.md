# Changelog

## 5.34.0

### Removed

- **BREAKING** Remove root ESLint/Prettier configs and compatibility formatting scripts, all published-package dependency declarations and obsolete typescript-eslint TypeScript package extensions. Oxlint/Oxfmt remain the toolchain for the workspace and new apps.

### Upgrading

- Migrate legacy apps with `npx warlock upgrade --from 5.33 --to 5.34.0`; review reported custom rules and the enabled correctness category.

## 5.33.0

### Changed

- Make root and package Oxlint/Oxfmt scripts the default monorepo lint/format toolchain, including Seal, Cascade, Herald, AI, Web and create-warlock. CI runs `format:check` and `lint:oxlint`.

### Deprecated

- Retain explicit `format:prettier` compatibility scripts with a warning naming 5.34.0 as the removal release; CI does not use them.
