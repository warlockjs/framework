---
title: "JSON File Channel"
description: "JSONFileLog — structured JSON output for log aggregators, with safe serialization."
sidebar:
  order: 4
  label: "JSON File"
---

`JSONFileLog` is a drop-in replacement for [`FileLog`](./03-file/) that writes structured JSON instead of plain text. Every entry is a typed object — no regex parsing at query time.

```ts
import { JSONFileLog } from "@warlock.js/logger";

const channel = new JSONFileLog({
  storagePath: process.cwd() + "/storage/logs",
  chunk: "daily",
});
```

:::note[Channel name is `"fileJson"`]
`JSONFileLog` registers under the internal name `"fileJson"` — **not** `"json"`. Use it when looking the channel up at runtime:

```ts
const jsonChannel = log.channel("fileJson");
```
:::

## File format

The extension is `json` (or `jsonl` with `format: "jsonl"`), regardless of the `extension` option. By default each file is a JSON object with a `messages` array:

```json
{
  "messages": [
    {
      "content": "New user created",
      "level": "info",
      "date": "15-03-2024 10:22:01",
      "module": "users",
      "action": "register"
    },
    {
      "content": "Card declined",
      "level": "error",
      "date": "15-03-2024 10:22:03",
      "module": "payments",
      "action": "charge",
      "stack": [
        "Error: Card declined",
        "    at chargeCard (/app/src/payments.ts:42:11)",
        "    at processTicksAndRejections (node:internal/process/task_queues:95:5)"
      ]
    }
  ]
}
```

## JSON Lines — `format: "jsonl"`

With the default `format: "json"`, every write reads the whole file, adds the new entries and writes it back, so a write gets slower as the file grows (up to `maxFileSize`, 10 MB by default). `format: "jsonl"` writes one JSON object per line to a `.jsonl` file and only appends, so each write costs the same however large the file is:

```ts
new JSONFileLog({ chunk: "daily", format: "jsonl" });
// storage/logs/2026-11-12.jsonl
// {"content":"New user created","level":"info","date":"12-11-2026 10:22:01","module":"users","action":"register","timestamp":"..."}
```

Each line holds the same fields as an entry of the `messages` array. Default: `"json"`.

## Corrupt files

When an existing `.json` file cannot be parsed (for example a write cut short by a crash), it is never overwritten: it is renamed to `<file>.json.corrupt-<epoch ms>` next to it, a new file is started, and the logger's `onChannelError` handler is told where the old file went.

## Differences from FileLog

| Aspect         | FileLog                               | JSONFileLog                                        |
| -------------- | ------------------------------------- | -------------------------------------------------- |
| Output format  | Plain-text lines                      | JSON object with `messages` array                  |
| Error stack    | Raw multi-line string after `[trace]` | Split on newlines, stored as `string[]` in `stack` |
| Message field  | Pre-formatted log line                | `content` field holds the original string          |
| File extension | Configurable (default `"log"`)        | `"json"`, or `"jsonl"` with `format: "jsonl"`      |

:::tip[Error stacks as arrays]
Storing the stack as `string[]` rather than a raw string makes it trivial to query in aggregators like Elasticsearch, Loki, or Datadog — no string-splitting at query time.
:::

It inherits every `FileLog` option and supports the same chunking, rotation, and `groupBy` features.

## Safe serialization

`JSONFileLog` writes through `safe-stable-stringify` (the same library Pino and Winston use), so the `context` payload can carry shapes that would otherwise throw in `JSON.stringify`:

| Shape                                      | Serialized as                                    |
| ------------------------------------------ | ------------------------------------------------ |
| Circular reference                         | handled (no throw)                               |
| `BigInt`                                   | stringified value                                |
| Function / `symbol`                        | dropped (standard JSON behavior)                 |
| `Error` (top-level or nested in `context`) | `{ name, message, stack, ...enumerableProps }`   |
| Class instance                             | enumerable own properties — same as default JSON |

The channel does **not** tag class instances with their class name. If you need a specific shape, pre-shape the value before passing it to `context`:

```ts
log.error("orders", "checkout", "Card declined", {
  order: { id: order.id, status: order.status }, // not the full Order instance
  declineReason,
});
```

:::tip[Why this matters]
A failing serialization used to throw inside the write path and lose the entry — the worst case for a logger, since the trace you needed is the one that disappeared. With safe serialization the write always succeeds and you get a recognizable placeholder for the unsafe parts.
:::
