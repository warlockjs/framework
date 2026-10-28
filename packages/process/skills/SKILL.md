---
name: warlock-js-process
description: 'Supervise owned child processes with `supervisor`, `ProcessNotOwnedError` and `UnsupportedProcessPlatformError`. Use for "start and stop a process", readiness checks, restart backoff, line-buffered output, IPC, graceful shutdown, pipelines or optional PTY sessions. Not this package → @warlock.js/queue for background jobs; @warlock.js/scheduler for cron; @warlock.js/ai-cli for coding-agent CLI adapters.'
---

# Supervise app-owned processes

Use `npx warlock add process` to pin the family package, create
`src/config/process.ts`, export `processes` from `src/app/processes/index.ts`,
and wire recovery/shutdown through `src/app/main.ts`. A second run preserves
existing files. Set a unique owner and registry per app instance.

```ts
import { supervisor, ProcessNotOwnedError } from "@warlock.js/process";

const processes = supervisor({
  owner: "example-app",
  registry: "storage/processes/registry.json",
  defaults: { timeoutMs: 30_000, memoryBytes: 512 * 1024 * 1024 },
});
await processes.recover({ keep: (entry) => entry.labels.persistent === "yes" });
const worker = await processes.spawn({
  kind: "worker",
  command: process.execPath,
  args: ["-e", 'console.log("ready"); setTimeout(() => {}, 1000)'],
  cwd: process.cwd(),
  env: { WORKER_MODE: "once" },
  labels: { room: "demo", member: "one" },
  limits: { timeoutMs: 10_000 },
});
worker.stdout.pipe(process.stdout);
worker.stderr.pipe(process.stderr);
console.log(await processes.list({ labels: { room: "demo" } }));
await processes.stop({ labels: { room: "demo", member: "one" } });
await worker.stop(); // idempotent after exit
console.log(await worker.exited); // reason, code, signal, peakMemoryBytes
try {
  await processes.stopPid(worker.pid); // an exited PID is no longer registered
} catch (error) {
  if (!(error instanceof ProcessNotOwnedError)) throw error;
}
await processes.stop(); // without a filter, stops all verified entries
await processes.stopAll(); // releases registry, permanently closes supervisor
```

No name/pattern stops. Labels match every requested key/value. `stop()` selects
all entries. `stopPid()` verifies ownership or throws `ProcessNotOwnedError`.
Recovery clears stale identities, adopts those selected by `keep`, and stops
other verified entries. Default recovery stops verified orphans. Adopted children
cannot regain stdio or original exit codes. Always recover before spawning.

The input `kind` is the workload category; listing calls it `type`.
Ownership is random environment token + PID + OS start time, with an isolated
group on POSIX; commands never prove ownership.
Do not expose tokens or the private registry. A second live supervisor for the
same registry fails. Corruption or incomplete leases require inspection.

## Terminals

Install optional peer `node-pty` only for terminals. Import happens lazily.

```ts
import { supervisor } from "@warlock.js/process";

const terminals = supervisor({ owner: "terminals", registry: "storage/terminals.json" });
await terminals.recover();
const terminal = await terminals.spawnPty({
  kind: "terminal",
  command: "/bin/sh",
  args: [],
  columns: 100,
  rows: 30,
  labels: { room: "demo" },
});
terminal.stdout.pipe(process.stdout);
terminal.write("printf 'hello\\n'\n");
terminal.resize(120, 40);
await terminal.stop();
console.log(await terminal.exited);
await terminals.stopAll();
```

PTY stdout combines terminal output; stderr is empty. `stdin` is writable too.

## Resource and lifecycle decisions

- Linux attempts a per-child cgroup v2 inside an already delegated directory
  (`cgroupRoot` overrides discovery). It does not request root or change the
  host's controllers. Denied writes fall back to `rlimit-polling`.
  For memory enforcement the delegated parent must be empty, with memory
  enabled; put the app in a separate leaf and use the parent as `cgroupRoot`.
- Limits: `timeoutMs`, `memoryBytes`, `cpuSeconds`, Linux-only
  `virtualMemoryBytes`. All are positive safe integers. Linux ignores
  `RLIMIT_RSS`; fallback RSS accounting covers the leader and can overshoot.
  V8 reserves large address space; avoid small address-space limits.
- macOS reads `ps` start times with `LC_ALL=C TZ=UTC`, applies CPU/data rlimits
  and polls tree RSS. Windows reads CIM creation times through one long-lived PowerShell helper per supervisor, polls tree
  working sets (`enforcement: "rss-polling"`) and stops verified trees with
  `taskkill /PID <pid> /T /F`. Memory caps on both are softer than Linux cgroups.
- Both use a Node guardian as the handle PID. It proves the random token from
  its own environment through a local socket/named pipe, gates workload launch
  until registry persistence, and survives supervisor restarts for recovery.
  Memory includes the guardian and its descendants. No identity-helper setup
  or custom native compilation is needed.
- Defaults per platform: `pollIntervalMs` 100 ms Linux, 500 macOS, 1500 Windows;
  `observationTimeoutMs` (ownership check wait) 2 s Linux, 15 s macOS/Windows. Explicit
  options win. Raise `observationTimeoutMs` on a loaded machine; the timeout error names it.
  The guardian replies to resume before launching the workload.
- Windows needs PowerShell/CIM. `cpuSeconds` is POSIX-only and
  `virtualMemoryBytes` Linux-only; unsupported limits fail before launch.
  Timeouts apply everywhere. Windows always forces the PID tree immediately;
  Job Objects remain a future hard-containment improvement. `spawnPty` uses
  optional `node-pty` on Windows/ConPTY too (use `powershell.exe` as the command).
- Read `enforcement` on listed entries. Kernel cgroup peaks include descendants;
  sampled peaks can miss short-lived descendants. Reasons are `exit`, `timeout`, `memory-cap`,
  `stopped`; allocation failures from rlimits may be ordinary exits.
- Without cgroups, descendants that create a session can escape; a leader that
  exits cannot be re-verified for escalation. This is not a hostile-code sandbox
  or an atomic identity-and-signal API. Windows trees also have discovery/PID-reuse
  races and require a live verified guardian for stopping.
- The generated `Application.onValidateBoot` awaits recovery and fails boot on
  error; `Application.onShutdown` awaits cleanup. For manual wiring, use the same
  hooks. Consume worker output to avoid backpressure.
  `exited` reports leader exit; await stream `end` events as well when collecting output.
- With devtools installed, the generated `app/processes/devtools.ts` exports a
  read-only list source, discovered only in development. No stop endpoint ships.

Platform source references and delegation details:
https://warlock.js.org/v/latest/process/.

## Configuration validation and guardian credentials

`supervisor()` requires nonempty string `owner` and `registry` options. Missing,
null or invalid configuration throws `TypeError` immediately, naming the first
invalid option (owner before registry). Validate deployment configuration before
starting work:

```ts
import { supervisor } from "@warlock.js/process";

const processes = supervisor({
  owner: "test-workers",
  registry: "storage/test-workers.json",
});
```

On macOS and Windows, only the guardian receives `WARLOCK_PROCESS_TOKEN` and
`WARLOCK_PROCESS_LAUNCH`. It authenticates ownership over its socket/named pipe;
both private variables are removed before spawning the workload (case-insensitively
on Windows). Ordinary environment entries reach the workload. Linux continues
to forward the token because ownership is checked through `/proc/<pid>/environ`.
