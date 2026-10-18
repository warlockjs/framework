# WR-015: @warlock.js/process: in-app process supervisor (5.33, owner-approved 2026-10-19)

Date: 2026-10-19 · Package: new (for example @warlock.js/process) · From: Bureau

**Today:** apps that start agent CLIs, terminals or workers need to stop only what they started. On 2026-10-18, stops by
name or pattern on a shared server took tenants' production apps down twice.

**Request:**
- `spawnOwned()` with an ownership token recorded on the process.
- `stop()` that verifies identity (PID, command line, token) before signalling, and stops the process group.
- Resource caps: cgroups on Linux, Job Objects on Windows.
- Orphan cleanup on restart.
- Exposed in devtools.

Not pm2: that's a machine-wide daemon for long-running services. See WR-017.

## Owner decision and API sketch

On 2026-10-19 the owner approved this as a **new package, `@warlock.js/process`, in 5.33**. It is separate from pm2
(WR-017).

The API sketch the owner reviewed is at https://claude.ai/artifact/CyhecsxKecTFBLsK76MAkz:
- `supervisor({ owner, registry, defaults })`.
- `spawn({ kind, command, args, cwd, env, labels, limits })`, returning stdout and stderr, `exited` with a reason
  (`exit`, `timeout`, `memory-cap` or `stopped`) and the peak memory.
- `stop()`, plus `stop({ labels })` to stop by room, member or any other label. There is no stop by name or pattern.
- `stopPid()`, which throws `ProcessNotOwnedError` for a process the app didn't start.
- `recover({ keep })` at boot, which adopts, stops or clears each registry entry.
- `spawnPty()` for terminals.
- `list({ labels })`, which feeds the UI and a devtools panel.
- `stopAll()` on app shutdown.

**Ownership:** a random token in the child's environment, plus the PID and process start time in the registry. The
command line is shown only, never used for matching.

**Enforcement:**
- Linux: a cgroup per child.
- Windows: a Job Object per child.
- macOS: resource limits only; document that the memory cap is softer.

Bureau's direct-session code is the first consumer and the reference for the behaviour.

## Install through `warlock add` (owner requirement, 2026-10-19)

`npx warlock add process` must install and wire the package, like the other optional packages (`warlock add devtools`):
- Add `@warlock.js/process` with the family's exact version.
- Generate `src/app/processes/` with a configured `supervisor(...)` export and the lifecycle wiring: `recover()` on app
  start and `stopAll()` on graceful shutdown.
- Add a typed config entry (owner name, registry path, default limits).
- Register the devtools panel when devtools is present.
- Print the next steps.

Running it twice must be a no-op. `warlock add` lists, docs and skills must include it.
