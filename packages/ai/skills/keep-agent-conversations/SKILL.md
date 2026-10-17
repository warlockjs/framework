---
name: keep-agent-conversations
description: 'Persisted multi-turn chat with one agent — ai.session({ id, store, agent, lock? }) with send / stream / history / load / fork / truncate / resume / clear, stored in ai.snapshot.file({ dir }) or ai.snapshot.sqlite({ path | database }) (also memory / pg / redis). Each send loads the history, runs agent.execute with it, stores the whole turn (tool rounds, provider blocks such as signed thinking and compaction, attachments) and saves; sends on one id are serialized; failed runs leave history unchanged; the agent''s compaction policy compacts long sessions; durable agents resume a crashed send. Triggers: `ai.session`, `session.send`, `session.stream`, `session.fork`, `session.truncate`, `session.resume`, `ConversationSession`, `ConversationSessionRecord`, `ConversationSendOptions`, `ai.snapshot.file`, `ai.snapshot.sqlite`, `node:sqlite`, `better-sqlite3`, `SqliteDatabaseLike`, `SessionLock`; ''chat history with an agent'', ''persist conversation to disk'', ''store chat in sqlite'', ''branch a conversation'', ''keep thinking blocks across turns'', ''two messages at once corrupt history''; typical import `import { ai } from "@warlock.js/ai"`. Skip: supervisor-shaped sessions with routing / commands — the `run-orchestrator` topic; crash-resume of one run — the `durable-agent-runs` topic; store contracts and pg/redis DDL — the `manage-ai-stores` topic.'
---

# Conversation sessions — `ai.session()`

A stored, multi-turn conversation with one agent. The session owns the history; you only send input.

```ts
import { ai, type ModelContract } from "@warlock.js/ai";

declare const model: ModelContract; // any provider model, e.g. anthropic.model({ name: "claude-opus-5-5" })

const assistant = ai.agent({ model, systemPrompt: "You are a helpful assistant." });

const chat = ai.session({
  id: "user-42",
  store: ai.snapshot.file({ dir: ".warlock/sessions" }), // or ai.snapshot.sqlite({ path: "chat.db" })
  agent: assistant,
});

await chat.send("My name is Sara.");
const result = await chat.send("What is my name?"); // AgentResult, history included
```

What `send(input, options)` does, under a per-session lock:

1. Load the record stored under `session:<id>`, mark it `pending: { runId, input }`.
2. Run `agent.execute(input, { ...options, history, captureMessages: true, sessionId: id })`.
3. On success, store the run's messages (without the agent's system prompt) plus the final reply with its `blocks`; on a failed / cancelled run keep the old history. Clear `pending`.

Stored turns keep every assistant tool-call turn and tool result, provider blocks (signed thinking, server compaction) and attachment parts, so a replayed thinking block sees exactly the history it was signed against.

## The rest of the API

```ts
const stream = chat.stream("Summarize our plan."); // events forwarded; result settles after the save
for await (const event of stream)
  if (event.type === "agent.trip.streaming") process.stdout.write(event.delta);
await stream.result;

await chat.history(); // Message[] copy
await chat.load(); // ConversationSessionRecord | undefined

const branch = await chat.fork("user-42-alt", { messageCount: 4 }); // throws if the id exists
await chat.truncate(2); // throws if the cut separates a tool call from its result
await chat.clear(); // delete the record

await chat.resume(); // continue a send left pending by a crash (agent needs `durable`); undefined if none
```

## Concurrency

Two `send`s on the same id never interleave: the second waits for the first to save. The default lock is in-process and shared by every session on the same store object. Several processes on one store need a distributed `SessionLock` (`lock: myLock`); `lock: false` disables locking.

```ts
const one = ai.session({ id: "shared", store, agent: assistant });
const two = ai.session({ id: "shared", store, agent: assistant });
await Promise.all([one.send("first"), two.send("second")]); // runs one after the other
```

## Stores

```ts
ai.snapshot.file({ dir: ".warlock/sessions" }); // one JSON file per key, atomic rename
ai.snapshot.sqlite({ path: "./data/chat.db" }); // node:sqlite (Node 22.5+; no flag on 22.13+, prints an experimental warning)
ai.snapshot.sqlite({ database: new Database("./data/chat.db") }); // better-sqlite3 (or any exec/prepare database)
```

`ai.snapshot.sqlite` creates its table on first use (`createTable: false` to opt out) and never loads `node:sqlite` when you pass `database`. Both stores are single-host. All snapshot factories are generic, so they type themselves as `SnapshotStore<ConversationSessionRecord>` when passed as `store`.

## Long sessions

Put a `compaction` policy on the agent; the first trip of each turn checks the stored history against the threshold, and the session saves the compacted conversation (summary and `compaction` markers included):

```ts
const assistant = ai.agent({
  model,
  compaction: {
    afterTokens: 150_000,
    keep: 2,
    summarize: ai.compaction.summarize({ model: cheapModel }),
  },
});
```

On Claude, `providerOptions.anthropic.serverCompaction` is the server-side alternative; the `compaction` block is stored on the turn's `blocks` like any other.

## Pitfalls

- Don't edit stored messages in place: replayed thinking is valid only while every earlier message is unchanged. Truncate (drop from the end) or fork instead. To recover an edited Claude conversation, send `providerOptions.anthropic.thinkingBlockBinding: "drop_block"` through the agent's `modelOptions`.
- The agent's system prompt is not stored; changing it changes the next turn's `system`, which also invalidates Claude's preserved thinking from earlier turns.
- Without `durable` on the agent, `resume()` throws; the next `send` replaces the pending mark.
