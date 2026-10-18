# Changelog — @warlock.js/process

## 5.33.0

### Added

- Add application-owned process supervision with random environment tokens, PID/start-time registry identity, safe group stops, label filtering, boot recovery and shutdown cleanup.
- Expose streamed worker handles, exit reasons and peak memory; lazily load optional `node-pty` for terminals.
- Ship a macOS identity helper using structured kernel environment data; require it before launching on macOS so command arguments cannot impersonate ownership.
- Attempt Linux cgroup v2 before user code executes, with POSIX resource limits and RSS polling fallback; document softer macOS limits and unsupported Windows native enforcement.
- Integrate `warlock add process` and a read-only devtools process panel.
