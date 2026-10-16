# Changelog — release tooling

## 5.31.0

### Fixed

- Origin confirmation retries registry propagation and read failures for thirty minutes with capped exponential backoff. The workflow uses this single window. Exhaustion prints origin-read, recorded-commit tag/push and registry blog-check recovery commands.
