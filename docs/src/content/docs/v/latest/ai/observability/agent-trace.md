---
title: "Agent traces"
description: Per-run, per-turn record of an agent's system prompt, tools offered, tool calls, results, refusals, retries, usage and cost, in development, with a devtools panel and warlock ai trace.
sidebar:
  order: 9
  label: "Agent traces"
---

When an agent behaves differently between two versions, the question is usually what it actually sent: which system prompt, which tools, and what each tool answered. An agent trace records that for every run, turn by turn, with no extra setup in development.

It is separate from [Panoptic](/v/latest/ai/observability/ai-panoptic/): Panoptic is the observability pipeline for production flows; a trace is a debugging aid that lives in memory and carries prompt and tool content.

## What is recorded

For each run (`AgentTrace`):

- the agent, version, model, user input, status, total usage and cost;
- the system prompt as a hash, and the text in development, so two runs can be diffed;
- per turn: the tools offered (name, schema hash, estimated tokens), the model's text, the finish reason, usage and cost;
- per tool call: arguments, result, status, duration, error, and the refusal reason when the tool refused;
- what the [tool-use contract](/v/latest/ai/agents/tool-use-contract/) did on the turn: re-prompts, refusal retries, backstops;
- the full definition behind every schema hash (`toolSchemas`).

## When it records

Default: **on in development, off under a test runner and in production.** Control it per agent:

```ts
ai.agent({ model, tools, trace: true }); // record everywhere; text only in development
ai.agent({ model, tools, trace: false }); // never
ai.agent({
  model,
  tools,
  trace: {
    text: true, // keep prompt, schemas and replies
    redact: { keys: ["memberCode"] }, // extra secret keys
    maxStringLength: 4000, // cut long strings
    store: myStore, // default: the shared agentTraces store
  },
});
```

Recording never fails or slows a run: every step swallows its own errors.

## Redaction

Traces use the logger's redaction before anything is stored. Keys such as `password`, `token`, `authorization` and `apiKey` are censored at any depth in tool arguments and results, and credentials registered with `registerLogSecret()` are masked inside prompt and reply text. `redact` adds your own keys and paths. Strings longer than `maxStringLength` (8000) are cut. Without text (`text: false`) only hashes, names, sizes and tool arguments and results remain.

## Reading traces in code

```ts
import { agentTraces, diffAgentTraces, formatAgentTrace } from "@warlock.js/ai";

const result = await coach.execute("Swap squats for lunges");
const trace = agentTraces.get(result.report.runId);

console.log(formatAgentTrace(trace!));
agentTraces.list({ agent: "coach", status: "failed", limit: 10 });
agentTraces.subscribe((event) => console.log(event.runId, event.status));
```

`agentTraces` holds the latest 100 runs (`createAgentTraceStore({ capacity })` makes another). A run is published when it starts and after each turn, so a trace of a long run is readable while it runs.

### Did these two versions send the same thing?

```ts
const diff = diffAgentTraces(agentTraces.get(before)!, agentTraces.get(after)!);
// {
//   identical: false,
//   systemPrompt: { changed: true, addedLines: [...], removedLines: [...] },
//   tools: { added: [], removed: [], changed: ["update_plan"] },
// }
```

Tools are compared by name and schema hash, so a changed description or field shows up as `changed`. The prompt lines are present when both runs kept the text.

## Devtools

With `@warlock.js/devtools` installed, the **Agents** tab at `/__warlock` lists recent runs (status, turns, tool calls, refusals, tokens, cost) and shows the selected run's system prompt, the tool definitions, every turn with its calls and refusals, and a comparison with the previous run of the same agent. Runs started during an HTTP request link to it. The tab updates as turns finish. It sits behind the same development-only, loopback-only guard as every devtools panel. Endpoints: `GET /__warlock/api/ai/agent-runs` and `GET /__warlock/api/ai/agent-runs/:id`.

## From the terminal

```sh
warlock ai trace                      # list recent runs
warlock ai trace run_ld8x3m_7fq2j1kp  # one run, turn by turn
warlock ai trace run_a --diff run_b   # same prompt and tools?
warlock ai trace run_a --json
```

The command asks the running dev server (`warlock dev`) for its traces; see [AI tools in the CLI](/v/latest/core/cli/ai/).

## Related

- [Lint tool schemas](/v/latest/ai/tools/lint-tool-schemas/) — the schema hash and token estimate behind "tools offered".
- [Redact secrets](/v/latest/ai/reliability/redact-secrets/) — registering credentials for masking.
- [The AI panel](/v/latest/devtools/ai-panel/) — the Panoptic-backed tab next to Agents.
