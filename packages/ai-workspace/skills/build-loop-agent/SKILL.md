---
name: build-loop-agent
description: "Wire a @warlock.js/ai-workspace into a coding agent that closes the read → edit → run-tests loop on its own. Triggers: `ws.tools.all()`, `ai.agent({ tools: ws.tools.all() })`, `maxTrips`, `run_tests`, `run_shell`, 'agent that fixes a failing test', 'make the suite green', 'coding agent that edits a repo', 'build-loop agent', 'self-correcting agent', 'read-only code reviewer', 'scaffold then hand off to an agent', 'share one workspace across a supervisor', 'least-privilege agent tools', 'errors as tool data'; typical wiring `const ws = ai.workspace({ cwd, shell }); ai.agent({ model, tools: ws.tools.all(), maxTrips })`. Skip: constructing the workspace / its policy / direct methods / readonly / scope — the `use-a-workspace` topic; the agent loop / maxTrips / events themselves — the `run-ai-agent` topic of the `warlock-js-ai` skill."
---

# Build a build-loop agent — read → edit → run tests, until green

The point of a workspace is to hand its tools to an agent and let it close the loop itself: read the failing spec, edit the source, run the tests, read the failure, fix again. The failure comes back as tool **data** (a non-zero `exitCode`, the captured `stderr`), not a thrown error — so the model can see what broke and self-correct.

```ts
import "@warlock.js/ai-workspace";
import { ai } from "@warlock.js/ai";

const ws = ai.workspace({
  cwd: "/srv/acme-api",
  denyPaths: [".git/**", ".env*"],
  shell: { allow: ["npm", "node"], inheritEnv: ["PATH"], timeoutMs: 120_000 },
});

const dev = ai.agent({
  model,
  tools: ws.tools.all(), // read/edit/multi_edit/apply_patch/write, list_dir, run_shell, run_tests, grep, glob, todo_write/todo_read
  maxTrips: 25, // give the loop room to iterate
});

await dev.execute("`npm test` fails on the cart-total suite. Make it green.");
```

## Why the loop works: errors as data

A failing test isn't a tool error — it's a normal result with `exitCode !== 0`. `run_tests` (and `run_shell`) return `{ exitCode, stdout, stderr, timedOut, truncated }` as the tool's `data`, so the model reads the failure on the next trip and tries again. The same is true of the policy/edit guards: a jail escape, a denied command, a non-unique edit, or a stale hash all come back as tool-error data the agent can react to, never a thrown run-killer. Give `maxTrips` enough headroom for the read → edit → test cycle to converge.

## Give the test command a path

`run_tests` defaults to `npm test`. It runs through the **same shell policy** as `run_shell`, so the agent can't run it unless:

- the executable basename is allowed — `shell: { allow: ["npm", "node"] }`, and
- the env can find it — `inheritEnv: ["PATH"]` (the workspace never inherits `process.env` wholesale).

Override the base command per agent: `ws.tools.runTests({ command: "vitest run" })`. A `pattern` the model supplies is appended as a filter (e.g. `vitest run cart-total`).

## Least-privilege variants

### A read-only reviewer

A reviewer should never write or run a shell. Pick exactly the read tools, or hand it a `readonly()` projection (which omits the mutating tools _and_ rejects the mutating direct methods):

```ts
const reviewer = ai.agent({
  model,
  tools: ws.tools.pick("readFile", "grep", "glob"),
});
await reviewer.execute("Review src/cart for off-by-one bugs and summarize.");

// Equivalent projection of the same jail:
ai.agent({ model, tools: ws.readonly().tools.all() }); // read_file, list_dir, grep, glob, todo tools
```

### Scope an agent to one package

`scope(subdir)` narrows the jail so a per-package agent can't reach outside it — one sub-agent per package, isolated blast radius:

```ts
const apiDev = ai.agent({ model, tools: ws.scope("packages/api").tools.all() });
const webDev = ai.agent({ model, tools: ws.scope("packages/web").tools.all() });
```

## Scaffold from code, then hand off

You don't have to let the agent do everything. Seed structure (and install deps) with the direct methods, then hand the tools to the agent for the creative part:

```ts
await ws.writeFile("src/routes.ts", ROUTES_BOILERPLATE);
await ws.exec("npm install zod");
await dev.execute("Implement the handlers declared in src/routes.ts.");
```

For a purely mechanical change, skip the LLM entirely: `ws.glob(...)` + a loop of `ws.editFile(...)` under the stale-hash guard.

## Share one workspace across a team

One workspace is one jail and one tree. Pass it to several members of a supervisor, varying only the tool slice each gets — they all read/write the **same** files:

```ts
const ws = ai.workspace({ cwd, shell: { allow: ["npm", "node"], inheritEnv: ["PATH"] } });

ai.supervisor({
  members: [
    ai.agent({ /* executor */ model, tools: ws.tools.all() }),
    ai.agent({ /* reviewer */ model, tools: ws.readonly().tools.all() }),
    ai.agent({ /* tester   */ model, tools: ws.tools.pick("readFile", "runTests") }),
  ],
});
```

## See also

- The `use-a-workspace` topic — building the workspace, the policy surface, the direct methods, `readonly` / `scope`, and the typed errors.
- The `run-ai-agent` topic of the `warlock-js-ai` skill — the agent loop, `maxTrips`, and the run report.
- The `run-supervisor` topic of the `warlock-js-ai` skill — coordinating the members that share one workspace.
