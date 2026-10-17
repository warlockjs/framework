---
title: "warlock board"
description: A file-based board two coding agents share — work items with a review state machine, append-only numbered messages per recipient, review verdict lines, and a blocking `watch` — in the git-ignored `.warlock/board/` folder, with `--json` on every action.
sidebar:
  order: 14
  label: "warlock board"
---

`warlock board` lets two coding agents — typically an **implementer** and a **reviewer** — work on the same project without a person relaying messages between them. The board is a folder of plain files in `.warlock/board/`: work items that move through a review state machine, and messages each agent appends to the other's inbox. Any agent that can run a shell command can use it, and every action prints JSON with `--json`.

```bash
warlock board init                                           # create .warlock/board/ (git-ignored)
warlock board add "Add the orders module" --assignee implementer --reviewer reviewer
warlock board status                                         # every item and inbox
warlock board status 1                                       # one item, its next states and history
warlock board status 1 in-progress --by implementer          # move an item
warlock board send reviewer "Orders ready" --from implementer --item 1 --body @notes.md
warlock board watch reviewer --timeout 900                   # block until a new message arrives
```

Nothing boots: the command reads and writes files only, so it works with or without a database, and while `warlock dev` runs.

## Actions

| Action                   | What it does                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`                   | Creates `.warlock/board/` and adds `.warlock/board/` to `.gitignore` (creating it if needed) unless `.warlock` is already ignored. Safe to repeat.    |
| `add <title>`            | Adds an item in state `todo`. `--assignee`, `--reviewer` and `--by` name agents.                                                                      |
| `status`                 | Lists every item and every inbox with its message and unread counts.                                                                                  |
| `status <id>`            | Prints one item, the states it may move to next, and its history.                                                                                     |
| `status <id> <state>`    | Moves the item. `--by` records who, `--note` why. A move the state machine does not allow fails with [`WL7403`](./error-codes.md#wl7403).             |
| `send <agent> <subject>` | Appends a message to `<agent>`'s inbox. `--from` (required, or `WARLOCK_AGENT`), `--item <id>`, `--body text` or `--body @file`, `--verdict`.         |
| `watch <agent>`          | Blocks until `<agent>` has a message it has not seen, prints it, and advances the agent's cursor. `--timeout <seconds>` (default 600), `--since <n>`. |

| Flag         | Applies to      | Description                                                                          |
| ------------ | --------------- | ------------------------------------------------------------------------------------ |
| `--json, -j` | every action    | Print one JSON object; stdout carries only the JSON.                                 |
| `--assignee` | `add`           | The agent doing the work.                                                            |
| `--reviewer` | `add`           | The agent reviewing it.                                                              |
| `--by`       | `add`, `status` | The agent making the change. Default: the `WARLOCK_AGENT` environment variable.      |
| `--note`     | `status`        | Why the item moved; stored in its history.                                           |
| `--from`     | `send`          | The sending agent. Default: `WARLOCK_AGENT`.                                         |
| `--item`     | `send`          | The item the message is about.                                                       |
| `--body`     | `send`          | The message body, or `@path` to read it from a file (relative to the project root).  |
| `--verdict`  | `send`          | `approved` or `changes-requested`. With `--item`, also moves the item to that state. |
| `--timeout`  | `watch`         | Seconds to wait. On timeout: exit code 3 and [`WL7404`](./error-codes.md#wl7404).    |
| `--since`    | `watch`         | Return messages numbered above this number instead of above the agent's cursor.      |

Agent names are lower-case letters, digits and dashes (`implementer`, `reviewer-2`). Set `WARLOCK_AGENT` in each agent's environment to stop repeating `--from` / `--by`.

### Exit codes and JSON

| Exit | Meaning                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Done. JSON: `{ "ok": true, … }`.                                                                                                                                                                                          |
| 1    | Refused or invalid: board not initialized (`WL7401`), unknown item (`WL7402`), disallowed move (`WL7403`), bad argument. JSON: `{ "ok": false, "code": "WL7403", "message": "…" }` (`code` is `null` for a bad argument). |
| 3    | `watch` timed out. JSON: `{ "ok": false, "code": "WL7404", "message": "…", "timedOut": true }`.                                                                                                                           |

## States

| State               | May move to                                    |
| ------------------- | ---------------------------------------------- |
| `todo`              | `in-progress`, `blocked`                       |
| `in-progress`       | `ready-for-review`, `blocked`, `todo`          |
| `ready-for-review`  | `approved`, `changes-requested`, `in-progress` |
| `changes-requested` | `in-progress`, `blocked`                       |
| `approved`          | `in-progress` (reopen)                         |
| `blocked`           | `todo`, `in-progress`                          |

Only the reviewer's verdict moves an item out of `ready-for-review` to `approved` or `changes-requested` in the normal loop; an implementer who withdraws a review request moves it back to `in-progress`.

## Files

```
.warlock/board/
  board.json                         # marker written by init
  items/
    0001-add-the-orders-module.json  # one JSON file per item
  to-reviewer/
    0001-orders-ready.md             # messages for the reviewer, numbered per inbox
  to-implementer/
    0001-review-of-orders.md
  cursors/
    reviewer                         # the highest message number watch returned to the reviewer
```

- **Items** are JSON: `{ id, title, state, assignee, reviewer, createdAt, updatedAt, history: [{ from, to, by, at, note }] }`. Item files are rewritten atomically (temp file and rename) when the item moves.
- **Messages are append-only.** Each number is reserved with an exclusive create before the file is written, so two agents sending at the same moment get different numbers, and a message file is never rewritten or deleted by the command.
- Ids and message numbers are never reused, even if a file is deleted by hand.

### Message format

```markdown
---
from: reviewer
to: implementer
item: 1
subject: Review of orders
at: 2026-10-17T09:12:44.512Z
---

The list endpoint returns the raw model; wrap it in OrderResource.

VERDICT: CHANGES REQUESTED
```

A verdict is the **last line**, exactly `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`. A verdict line quoted earlier in the body does not count. When the message names an item, sending the verdict also moves the item — and if the item's state does not allow it, the command fails with `WL7403` and writes no message.

## The two-agent protocol

Two agents, each in its own terminal or session, with `WARLOCK_AGENT` set to its name.

**Implementer**

```bash
warlock board init
warlock board add "Add the orders module" --assignee implementer --reviewer reviewer --json
warlock board status 1 in-progress
# … write the code, run `warlock check --changed` until it passes …
warlock board status 1 ready-for-review --note "check passes"
warlock board send reviewer "Orders module ready" --item 1 --body @handoff.md
warlock board watch implementer --timeout 1800 --json   # wait for the verdict
```

**Reviewer**

```bash
warlock board watch reviewer --timeout 1800 --json      # blocks until the implementer's message
# … read the diff, run `warlock check --changed` …
warlock board send implementer "Review of orders" --item 1 --verdict changes-requested --body @review.md
warlock board watch reviewer --timeout 1800 --json      # wait for the next round
```

**Implementer, on `changes-requested`**

```bash
warlock board status 1 in-progress
# … fix …
warlock board status 1 ready-for-review
warlock board send reviewer "Fixed the review" --item 1 --body "Wrapped the list in OrderResource."
```

The loop ends when the reviewer sends `--verdict approved`. Rules that keep the loop reliable:

- Only the reviewer sends verdicts; only the assignee moves an item to `ready-for-review`.
- Every round is a new message; nobody edits an earlier one, so the inbox is the review history.
- `watch` returns every unread message at once and advances the cursor, so an agent that was busy never misses one. `--since 0` replays the whole inbox.
- A `watch` timeout (exit 3) is not an error in the work: run it again.

## agent-kit

`@mongez/agent-kit`, which syncs skills into each agent's directory, lives outside this repository. It can drive the same protocol by calling these commands; the board's files are the whole contract, so nothing else is needed to integrate it.

## From code

```ts
import {
  addBoardItem,
  initBoard,
  moveBoardItem,
  sendBoardMessage,
  watchBoard,
} from "@warlock.js/core/tooling";

initBoard();
const item = addBoardItem({ title: "Add the orders module", assignee: "implementer" });
moveBoardItem(item.id, "in-progress", { by: "implementer" });
moveBoardItem(item.id, "ready-for-review", { by: "implementer" });
sendBoardMessage({ to: "reviewer", from: "implementer", subject: "Ready", item: item.id });

const { messages } = await watchBoard({ agent: "implementer", timeoutMs: 60_000 });
```
