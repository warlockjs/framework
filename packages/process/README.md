# @warlock.js/process

App-owned child process supervision for Linux, macOS and Windows. Ownership uses a random
environment token, PID, OS start time and a private registry. Stops target verified POSIX process groups or a Windows PID tree; commands are
never used for identity matching.

```sh
npx warlock add process
```

```ts
import { supervisor } from "@warlock.js/process";

const processes = supervisor({
  owner: "example-app",
  registry: "storage/processes/registry.json",
  defaults: { timeoutMs: 30_000, memoryBytes: 512 * 1024 * 1024 },
});
await processes.recover();
const worker = await processes.spawn({
  kind: "worker",
  command: process.execPath,
  args: ["-e", 'console.log("ready")'],
  labels: { room: "demo" },
});
worker.stdout.pipe(process.stdout);
worker.stderr.pipe(process.stderr);
console.log(await worker.exited);
await processes.stopAll();
```

Public methods: `spawn`, `spawnPty`, `list`, `stop`, `stopPid`, `recover`,
`stopAll`. Handles provide streams, `exited` (reason, exit code, signal, peak
memory) and idempotent `stop`. Unowned PIDs throw `ProcessNotOwnedError`.

| Platform | Identity and enforcement                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Linux    | `/proc` start ticks + boot ID + environment token; cgroup v2 → inherited rlimit/RSS fallback.                               |
| macOS    | `ps` start time (`LC_ALL=C TZ=UTC`) + environment token; inherited CPU/data rlimits and tree RSS polling.                   |
| Windows  | PowerShell/CIM creation time + environment token; `taskkill /PID <pid> /T /F` and tree working-set polling (`rss-polling`). |

macOS and Windows memory caps are softer than Linux cgroups: polling can miss
peaks and overshoot. No custom native code or identity-helper setup is required.
On these platforms the handle PID belongs to a small Node guardian that launches
the workload after registry persistence. It proves its inherited environment
token through a live local socket/named pipe; polling includes guardian overhead
and descendants. Recovery uses the same PID/start-time/token verification.
Windows needs Windows PowerShell with CIM available. `cpuSeconds` is POSIX-only;
`virtualMemoryBytes` is Linux-only. Timeouts work on all three platforms.
Windows stops force the entire PID tree immediately; Job Objects are a future
improvement for hard containment and memory caps.
`spawnPty` lazily imports optional peer `node-pty`, including Windows/ConPTY.

Use a separate registry per app instance and consume output streams. Recovery
adopts only identities selected by `keep`; by default it stops verified orphans.
`stopAll` permanently closes the supervisor. The installer wires recovery on
startup, shutdown cleanup and a read-only devtools Processes panel.

See [the complete documentation](https://warlock.js.org/v/latest/process/) for
platform limits, delegation, PID reuse limitations, recovery and terminal APIs.
