# Changelog

## 5.33.0

### Changed

- Make root and package Oxlint/Oxfmt scripts the default monorepo lint/format toolchain, including Seal, Cascade, Herald, AI, Web and create-warlock. CI runs `format:check` and `lint:oxlint`.

### Deprecated

- Retain explicit `format:prettier` compatibility scripts with a warning naming 5.34.0 as the removal release; CI does not use them.
