# Changelog — @warlock.js/process

## 5.53.1 - 2026-11-12

### Changed

- On Windows, a supervisor call that is waiting for the process-query helper's answer now keeps Node running until the answer arrives (normally milliseconds; at most `observationTimeoutMs`). An idle helper still never keeps the process alive. A pending query, including one started by the monitor's background poll, can therefore delay a natural exit by that long.

### Fixed

- On Windows, a script that awaited `supervisor().recover()`, `spawn()`, `list()` or any other supervisor call at top level, with nothing else keeping Node running, exited with code 13 ("unsettled top-level await") about 20 ms into the call. The process-query helper (one PowerShell per supervisor) and its pipes do not hold the process open, and the timer guarding its answer did not either, so Node exited before PowerShell could reply. The timer now keeps the process alive while a call waits for the answer, so the call settles. `recover()` with no registry file yet resolves with an empty recovery (`{ adopted: [], stopped: [], cleared: [] }`) on every platform. Apps whose server already kept Node running were not affected.

## 5.45.0 - 2026-11-05

### Added

- `pidWaitMs` supervisor option: how long a terminal may take to report a real process ID after `spawnPty()`. Defaults to 10 s. ConPTY reports pid 0 for a moment after spawn on Windows; the supervisor now waits for the real pid instead of supervising pid 0.
- `setupTimeoutMs` supervisor option: how long a launched child has to reach its resource setup gate. Defaults to 5 s on Linux and 30 s on Windows and macOS. Explicit values win.
- `ProcessStartupError`, thrown when a launch cannot be supervised. Its `reason` is `no-pid` (no real pid arrived within `pidWaitMs`), `exited` (the child exited before its gate) or `setup-timeout` (the gate was not reached within `setupTimeoutMs`).

### Changed

- The setup gate deadline is 30 s on Windows and macOS (it was 5 s on every platform). Linux keeps 5 s.
- A launch that fails at its setup gate now rejects with `ProcessStartupError`; the message is unchanged.

### Fixed

- A terminal that reported pid 0 right after `spawnPty()` could be supervised under pid 0. The launch now waits for a real pid, and a terminal that never reports one is stopped on a best-effort basis and rejected with `ProcessStartupError`.

## 5.40.0 - 2026-10-29

### Fixed

- Stopping a handle immediately after `spawn()` could fail with `ProcessNotOwnedError` on Linux while the launcher was replacing itself with the workload. The stop now waits out that moment before verifying ownership.
- Sampling a process that was exiting could report `ProcessNotOwnedError` from a slightly stale process-table snapshot. A mismatch is now re-read fresh first, and a process that is gone counts as exited.
- Calling `supervisor()` a second time in the same process with the same registry and owner (for example from a second copy of the module after a dev hot reload) now returns the live supervisor instead of failing every launch with "Process registry is already in use". Once `stopAll()` has finished the registry is free and a new supervisor is created. A different owner on the same registry is still refused.

### Added

- `observationTimeoutMs` supervisor option: how long the ownership check waits for a guardian reply (and, on Windows, the process helper). Defaults to 2 s on Linux and 15 s on Windows and macOS; the timeout error now names the option.
- Platform defaults for `pollIntervalMs`: 100 ms on Linux, 500 ms on macOS, 1500 ms on Windows. Explicit values still win.

### Changed

- Windows keeps one long-lived PowerShell helper per supervisor instead of starting PowerShell twice per observation. Observations made together share one query, polling reuses a snapshot up to one interval old, the helper restarts if it dies and closes with `stopAll()`.
- On Windows and macOS the launch gate waits on the guardian's pipe instead of reading the full process identity every 10 ms.

### Fixed

- Members failed to start on a busy Windows machine with `Process ownership observation timed out`. The guardian now replies to the resume request before it launches the workload, so a slow program start no longer counts against the client's timeout.

## 5.34.3 - 2026-10-20

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
