# Changelog — @warlock.js/process

## 5.34.3

### Changed

- The agent skill now exports as `warlock-js-process`; package discovery descriptions stay within 450 characters.

## 5.34.0 - 2026-10-19

### Fixed

- Validate supervisor configuration before accessing options; errors name the missing or invalid `owner` or `registry` option.

### Security

- Strip guardian ownership and launch variables from macOS/Windows workload environments, including Windows casing aliases. Guardian proof remains intact; Linux retains its `/proc` ownership token.

## 5.33.0 - 2026-10-19

### Added

- Add application-owned process supervision with random environment tokens, PID/start-time registry identity, safe group stops, label filtering, boot recovery and shutdown cleanup.
- Expose streamed worker handles, exit reasons and peak memory; lazily load optional `node-pty` for terminals.
- Support macOS without custom native code: parse `ps` start time under `LC_ALL=C TZ=UTC` and verify the inherited random environment token through a live Node launch guardian.
- Support Windows with PowerShell/CIM creation identity, the guardian's inherited token, PID-only `taskkill /T /F` tree stops, tree working-set polling, timeouts, recovery and optional node-pty/ConPTY terminals. Job Objects remain a future improvement.
- Make platform command construction, parsing and launch plans pure and observation injectable for Linux-hosted macOS/Windows specs; reject truly unsupported operating systems with `UnsupportedProcessPlatformError`.
- Attempt Linux cgroup v2 before user code executes, with inherited rlimit/RSS fallback; document softer macOS rlimit/tree RSS and Windows tree RSS enforcement, guardian memory overhead and POSIX-only CPU limits.
- Integrate `warlock add process` and a read-only devtools process panel.
