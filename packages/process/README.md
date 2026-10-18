# @warlock.js/process

App-owned child process supervision for Linux and macOS. Ownership uses a random
environment token, PID, OS start time and a private registry. Stops target only
verified process groups; commands are never used for identity matching.

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

Linux attempts delegated cgroup v2 before running user code. Without permission,
inherited POSIX limits and leader RSS polling apply. macOS uses data/CPU limits
and RSS polling with softer memory enforcement. Windows is explicitly
unsupported until a native identity/Job Object helper is available.
`spawnPty` lazily imports optional peer `node-pty`.

Use a separate registry per app instance and consume output streams. Recovery
adopts only identities selected by `keep`; by default it stops verified orphans.
`stopAll` permanently closes the supervisor. The installer wires recovery on
startup, shutdown cleanup and a read-only devtools Processes panel.

See [the complete documentation](https://warlock.js.org/v/latest/process/) for
platform limits, delegation, PID reuse limitations, recovery and terminal APIs.

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
