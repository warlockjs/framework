---
name: review-a-change
description: "Review a change as an independent reviewer who sees only the task and the diff, never the author's summary, and answers one question: list every change the task did not ask for. Use when asked to review work an agent or a colleague finished, before a merge."
---

# Review a change

The Grimoire is experimental: its file structure and commands may still change.

The reviewer is independent. It reads two things only: the task file and the diff. It does not read the author's summary, the commit messages' explanations or the author's report; they describe what the author meant, not what changed.

## Input

1. The task file (`grimoire/tasks/open/T-12-….md` or `grimoire/tasks/done/…`), including its `Files:`, `Features:`, `Locked:`, `Touches:` and `Removes:` lines.
2. The diff: `git diff <base>...HEAD`, where `<base>` is the branch the change merges into (`origin/main`).

## The question

Ask exactly this, and answer it before anything else:

> List every change the task did not ask for.

Go file by file through the diff. For each hunk say which sentence or acceptance criterion of the task asks for it. A hunk no sentence asks for goes on the list: an unasked file, a removed or reworded criterion, a deleted or weakened test, a renamed export, a changed dependency, a new behaviour, a refactor. "Harmless" and "an improvement" are not reasons to leave it out.

## Then

1. Run the guard and paste its output:

   ```bash
   npx warlock grimoire guard <task> --base <base>
   ```

2. List every drift item that is not approved, by id, from `npx warlock grimoire check` (`GR4017` capture differs, `GR4018` structure changed, `GR4019` rejected change still there). Leave none out and do not approve any: only the owner approves.
3. Say whether the change is ready: yes only when the list of unasked changes is empty (or each item is named in the task and approved by the owner), the guard prints `guard: ok`, and no drift item is open.

## Report shape

```md
Unasked changes

- <file>: <what changed>, no sentence of the task asks for it

Guard
<the pasted output>

Not approved

- <drift item id>

Verdict: ready | not ready, because …
```

An empty "Unasked changes" section says "none" and the reviewer says which files it read.
