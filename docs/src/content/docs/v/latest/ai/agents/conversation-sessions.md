---
title: "Conversation sessions"
description: ai.session() — a persisted multi-turn conversation with one agent. Each send loads the history, runs the agent, stores the whole turn (tool rounds and provider blocks included) and saves it; fork, truncate and crash resume included.
sidebar:
  order: 6
  label: "Conversation sessions"
---

`ai.session({ id, store, agent })` keeps a multi-turn conversation with one agent in a snapshot store. Each `send` loads the stored history, runs `agent.execute(input, { history })`, appends the turn and saves it. It stores the turn the way the provider needs it back: every assistant tool-call turn and tool result of the run, the provider `blocks` (signed thinking, compaction) and the final reply exactly as the model sent it.

```ts
import { ai } from "@warlock.js/ai";

const assistant = ai.agent({ model, systemPrompt: "You are a helpful assistant.", tools });

const chat = ai.session({
  id: "user-42",
  store: ai.snapshot.file({ dir: ".warlock/sessions" }),
  agent: assistant,
});

await chat.send("My name is Sara.");
const result = await chat.send("What is my name?");
console.log(result.text);
```

`send` returns the agent's `AgentResult` and takes the agent's execute options except `history` (the session owns it): `attachments`, `placeholders`, `output`, `signal`, `on` and so on. `sessionId` defaults to the session id, so every report node of the turn is grouped under it.

## What is stored

The record lives under the key `session:<id>`:

```ts
type ConversationSessionRecord = {
  runId: string; // "session:<id>"
  type: "conversation-session";
  id: string;
  messages: Message[]; // the conversation the agent sees next turn
  turns: number;
  createdAt: string;
  updatedAt: string;
  forkedFrom?: { id: string; messageCount: number };
  pending?: { runId: string; input: string; startedAt: string };
};
```

`messages` never holds the agent's system prompt: the agent adds it on every run, so a changed prompt applies to the next turn. A user turn sent with attachments is stored with its resolved parts, so the next request sends the same bytes. A failed or cancelled run leaves `messages` unchanged.

Read it back with `chat.history()` (a copy of `messages`) or `chat.load()` (the record).

## Stores

Any `SnapshotStore` works:

| Store                           | Fits                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `ai.snapshot.file({ dir })`     | Local-first apps and CLIs (one JSON file per session) |
| `ai.snapshot.sqlite({ path })`  | Local-first apps with many sessions in one file       |
| `ai.snapshot.pg()` / `.redis()` | Servers, several processes                            |
| `ai.snapshot.memory()`          | Tests                                                 |

Every factory is generic over the snapshot shape, so `ai.snapshot.file({ dir })` passed as `store` is typed `SnapshotStore<ConversationSessionRecord>` for you. Session keys are prefixed `session:`, so one directory or database can hold sessions and durable run snapshots side by side (create one store per shape). See [Persist AI data](/v/latest/ai/reliability/persist-ai-data/) for the file and SQLite stores.

Local stores use private POSIX permissions by default: newly created directories are `0700`, JSON files (including temporary files and rewrites) and SQLite databases/sidecars are `0600`. Existing directories are never chmod-ed; choose a private location or secure an existing directory yourself. File stores accept `{ dirMode, fileMode }` overrides and refuse group/other write bits. For example, `ai.snapshot.file({ dir: ".warlock/sessions", dirMode: 0o750, fileMode: 0o640 })` allows a trusted group to read. Directory modes are subject to umask; saved JSON file modes are exact. With `sqlite({ database })`, the caller manages file permissions. Windows ignores POSIX modes; use filesystem ACLs there. See [Local file permissions](/v/latest/ai/reliability/persist-ai-data/#local-file-permissions).

## Concurrency

Calls on one session id are serialized: two `send`s never interleave history. The second waits for the first to save, then runs with the first turn in its history. The default lock is in-process and shared by every `ai.session()` on the same store object. For several processes over one store, pass a distributed lock (any `SessionLock`, the same contract the orchestrator uses), or `lock: false` when something else already guarantees a single writer:

```ts
ai.session({ id, store, agent, lock: redisSessionLock });
```

An aborted `signal` stops a send that is still waiting for the lock.

## Streaming

`chat.stream(input, options)` runs the turn through `agent.stream` and forwards every event. `stream.result` settles after the turn is saved:

```ts
const stream = chat.stream("Summarize our plan.");

for await (const event of stream) {
  if (event.type === "agent.trip.streaming") process.stdout.write(event.delta);
}

await stream.result;
```

## Fork and truncate

```ts
// Branch the first four messages into a new session.
const branch = await chat.fork("user-42-alt", { messageCount: 4 });
await branch.send("Let's try the other approach.");

// Drop everything after the first two messages.
await chat.truncate(2);
```

`fork` copies the prefix unchanged, so signed thinking in it stays valid in the branch (a provider checks that everything before a thinking block is unchanged, and a branch that replays the history up to the fork point keeps it). It throws when the target id exists. `truncate` keeps the first `messageCount` messages and throws when the cut would separate a tool call from its result. Removing turns from the end keeps earlier blocks valid; editing earlier turns would not, so the session offers no in-place edit. `chat.clear()` deletes the record.

## Compaction

Give the agent a `compaction` policy and long sessions compact themselves: the threshold is checked before every trip, including the first trip of a turn, where the stored history is what grows. The session stores the compacted conversation, summary and markers included, so the next turn starts from it:

```ts
const assistant = ai.agent({
  model,
  tools,
  compaction: {
    afterTokens: 150_000,
    keep: 2,
    summarize: ai.compaction.summarize({ model: cheapModel }),
  },
});
```

On Anthropic models, server-side compaction (`providerOptions.anthropic.serverCompaction`) is an alternative: the `compaction` block comes back on the assistant turn's `blocks`, the session stores it, and the API drops what came before it on the next request. See [Automatic compaction](/v/latest/ai/agents/run-agent/#automatic-compaction-inside-an-agent-run) and [Anthropic → Context editing and server-side compaction](/v/latest/ai/providers/anthropic/#context-editing-and-server-side-compaction).

## Resume after a crash

Before running, `send` marks the record `pending` with the run id; it clears the mark when the turn is saved. A process that stops mid-run leaves the mark behind. With a [durable agent](/v/latest/ai/reliability/durable-execution/), `chat.resume()` continues that run from its last checkpoint through `agent.resume(runId)` and saves the turn:

```ts
const assistant = ai.agent({
  model,
  tools,
  durable: { store: ai.snapshot.sqlite({ path: "runs.db" }) },
});
const chat = ai.session({ id: "user-42", store, agent: assistant });

await chat.resume(); // undefined when nothing is pending
```

Without `durable` there is nothing to continue: `resume()` fails with the agent's "no durable store" error, and the next `send` simply replaces the pending mark (the interrupted turn is not stored).

## Related

- [Run agent](/v/latest/ai/agents/run-agent/) — `history`, `captureMessages` and provider blocks.
- [Durable execution](/v/latest/ai/reliability/durable-execution/) — crash resume for a single run.
- [Run orchestrator](/v/latest/ai/orchestration/run-orchestrator/) — supervisor-shaped sessions with routing and commands.
