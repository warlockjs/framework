# Changelog

## 5.32.0

### Security

- Require esbuild ^0.28.2 in standalone site installs as well as the workspace, past the Windows development-server advisory [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) (patched in 0.28.1).

### Changed

- Pin the native TypeScript compiler to 7.0.2 and typecheck with supported configuration options.
