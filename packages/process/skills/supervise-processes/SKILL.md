---
name: supervise-processes
description: Start, limit, list, stop and recover app-owned workers or terminals using @warlock.js/process. Covers supervisor, ProcessNotOwnedError, spawnPty and warlock add process. Use for child process ownership and resource caps.
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
Ownership is random token + PID + start time + isolated group, never command text.
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
- macOS uses CPU/data limits and softer RSS polling, with the shipped native
  identity helper configured. Windows throws before
  launch: no native Job Object/identity helper ships in this package.
- Read `enforcement` on listed entries. Kernel cgroup peaks include descendants;
  fallback sampled peaks do not. Reasons are `exit`, `timeout`, `memory-cap`,
  `stopped`; allocation failures from rlimits may be ordinary exits.
- Without cgroups, descendants that create a session can escape; a leader that
  exits cannot be re-verified for escalation. This is not a hostile-code sandbox
  or an atomic pidfd signal API. macOS needs the shipped native identity helper configured.
- The generated `Application.onValidateBoot` awaits recovery and fails boot on
  error; `Application.onShutdown` awaits cleanup. For manual wiring, use the same
  hooks. Consume worker output to avoid backpressure.
  `exited` reports leader exit; await stream `end` events as well when collecting output.
- With devtools installed, the generated `app/processes/devtools.ts` exports a
  read-only list source, discovered only in development. No stop endpoint ships.

Platform source references and delegation details:
https://warlock.js.org/v/latest/process/.

## macOS identity helper

macOS requires the bundled helper so argv text cannot impersonate an environment
ownership token. On a Mac with the command-line developer tools installed:

```sh
mkdir -p .warlock/bin
cc node_modules/@warlock.js/process/native/darwin-identity.c -o .warlock/bin/process-identity
export WARLOCK_PROCESS_IDENTITY_HELPER="$PWD/.warlock/bin/process-identity"
```

Compile during deployment and set the absolute helper path in the app's runtime
environment. It uses Apple's `proc_pidinfo` and `KERN_PROCARGS2` and reads only
the explicitly selected PID. It never signals processes. Without the helper,
macOS supervision fails before spawning. The package does not compile native
code during installation. Linux does not need this helper.
