# WR-015: in-app process supervision for short-lived child processes (later)

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
