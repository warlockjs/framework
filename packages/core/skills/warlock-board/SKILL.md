---
name: warlock-board
description: 'Coordinate two coding agents (an implementer and a reviewer) through `warlock board`: work items with a review state machine (todo, in-progress, ready-for-review, changes-requested, approved, blocked), append-only numbered messages per recipient in the git-ignored `.warlock/board/`, `VERDICT: APPROVED` / `VERDICT: CHANGES REQUESTED` lines that move the item, and a blocking `watch` with a timeout; `--json` on every action. Triggers: `warlock board`, `board init`, `board add`, `board status`, `board send`, `board watch`, `--verdict`, `WARLOCK_AGENT`, `.warlock/board`, `to-reviewer/`, `initBoard`, `addBoardItem`, `moveBoardItem`, `sendBoardMessage`, `watchBoard`, `readBoardStatus`, `WL7401`, `WL7402`, `WL7403`, `WL7404`; "hand this to the reviewer agent", "wait for the review", "two agents working together", "request changes", "approve the item". Skip: verifying the code itself — the `warlock-check` topic; app facts — the `warlock-inspect` topic.'
---

# Warlock — `warlock board`

A shared folder of plain files two agents use to hand work back and forth: **items** move through review states, **messages** are appended to the other agent's inbox, and `watch` blocks until something new arrives. Set `WARLOCK_AGENT` to your agent name so `--from` / `--by` default to it.

```bash
export WARLOCK_AGENT=implementer
npx warlock board init
npx warlock board add "Add the orders module" --assignee implementer --reviewer reviewer --json
npx warlock board status --json
```

## The loop

Implementer:

```bash
npx warlock board status 1 in-progress
# write the code; loop on `npx warlock check --changed --json` until it is clean
npx warlock board status 1 ready-for-review --note "check passes"
npx warlock board send reviewer "Orders module ready" --item 1 --body @handoff.md
npx warlock board watch implementer --timeout 1800 --json   # blocks for the verdict
```

Reviewer (`WARLOCK_AGENT=reviewer`):

```bash
npx warlock board watch reviewer --timeout 1800 --json
# review the diff, run `npx warlock check --changed --json`
npx warlock board send implementer "Review of orders" --item 1 --verdict changes-requested --body @review.md
# or, when it is right:
npx warlock board send implementer "Approved" --item 1 --verdict approved
```

On `changes-requested` the implementer moves the item back with `status 1 in-progress`, fixes, moves it to `ready-for-review` and sends a new message. The loop ends on `approved`.

## States

| From                | Allowed next                                   |
| ------------------- | ---------------------------------------------- |
| `todo`              | `in-progress`, `blocked`                       |
| `in-progress`       | `ready-for-review`, `blocked`, `todo`          |
| `ready-for-review`  | `approved`, `changes-requested`, `in-progress` |
| `changes-requested` | `in-progress`, `blocked`                       |
| `approved`          | `in-progress` (reopen)                         |
| `blocked`           | `todo`, `in-progress`                          |

Anything else fails with `WL7403`, and the message lists the allowed states. `npx warlock board status <id> --json` returns `{ item, next }`.

## Reading what `watch` returns

```json
{
  "ok": true,
  "timedOut": false,
  "agent": "implementer",
  "cursor": 3,
  "messages": [
    {
      "number": 3,
      "file": ".warlock/board/to-implementer/0003-review-of-orders.md",
      "from": "reviewer",
      "to": "implementer",
      "item": 1,
      "subject": "Review of orders",
      "at": "2026-10-17T09:12:44.512Z",
      "body": "Wrap the list response in OrderResource.",
      "verdict": "changes-requested"
    }
  ]
}
```

- Every unread message comes back at once, oldest first, and the cursor moves past them. `--since 0` replays the inbox.
- Timeout: exit code **3** and `{ "ok": false, "code": "WL7404", "timedOut": true }`. Just run `watch` again.
- A message file ends with exactly `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED` when it carries a verdict.

## From code

```ts
import {
  initBoard,
  addBoardItem,
  moveBoardItem,
  sendBoardMessage,
  watchBoard,
} from "@warlock.js/core/tooling";

initBoard();
const item = addBoardItem({
  title: "Add the orders module",
  assignee: "implementer",
  reviewer: "reviewer",
});
moveBoardItem(item.id, "in-progress", { by: "implementer" });
moveBoardItem(item.id, "ready-for-review", { by: "implementer" });
sendBoardMessage({
  to: "reviewer",
  from: "implementer",
  subject: "Ready",
  item: item.id,
  body: "See the diff.",
});

const { messages } = await watchBoard({ agent: "implementer", timeoutMs: 30 * 60_000 });
```

## Gotchas

- Run `init` first; every other action fails with `WL7401` until the board exists. `init` git-ignores `.warlock/board/`.
- Messages are append-only and numbered per inbox; never edit or delete one by hand — send a new message.
- A verdict naming an item moves it; if the item is not in `ready-for-review`, the send fails with `WL7403` and no message is written.
- Agent names: lower-case letters, digits and dashes.
- `@mongez/agent-kit` lives outside this repository; it integrates by calling these commands.

## See also

- The `warlock-check` topic — the verify command both agents loop on.
- The `warlock-inspect` topic — the app's facts as JSON before you change it.
