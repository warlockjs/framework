# Changelog — release tooling

## 5.31.0

### Fixed

- Origin confirmation retries registry propagation and read failures for thirty minutes with capped exponential backoff. The workflow uses this single window. Exhaustion prints origin-read, recorded-commit tag/push and registry blog-check recovery commands.

- CI and the release gate reject internal report identifiers and configured private application names anywhere in package and documentation sources, with file and line diagnostics.

- Restored a damaged historical locale-folder changelog entry and removed private application attribution from published package history and documentation. The public-text gate now rejects the additional configured name.
