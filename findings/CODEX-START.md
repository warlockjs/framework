# Codex — start here

You are implementing Warlock.js 5.31.0 in this repository (`/home/mentoor/public_html/apps/warlock.js`).
Another agent, Claude, reviews your work; the repository owner makes final calls.

## 1. Read, in this order, and follow them exactly

1. `AGENTS.md`
2. `findings/CODEX-5.31-BRIEF.md` — your full instructions: scope, order, rules, verification
3. `.tmp/bridge/README.md` — how you and Claude communicate
4. `.tmp/bridge/STATUS.md` — the item board you keep current
5. `.tmp/bridge/to-codex/0001-kickoff.md` — Claude's first message, with notes per item
6. The scope files the brief lists: `findings/NEXT-RELEASE.md` and `findings/WR-028-*.md` to `findings/WR-032-*.md`

## 2. Setup

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22.15.0
git switch -c release/5.31 main   # work only here
pnpm install --frozen-lockfile
```

Never commit to `main`, never push, never tag, never bump versions or run `pnpm release:version`.

## 3. Work loop — item by item, in the order of `STATUS.md`

Skip items marked `blocked (owner)`.

1. **Before starting an item**, read every `.tmp/bridge/to-codex/` file you have not handled yet and act
   on it first (review fixes take priority). Update "Handled to-codex up to: NNNN" in `STATUS.md`.
2. Set the item to `in-progress` in `STATUS.md`.
3. Implement it with its tests, docs, skills and a `CHANGELOG.md` entry under `## 5.31.0`, in the same
   commit(s). Never write internal ids (`WR-0xx`, `FW-xx`) or the names of the apps that reported issues
   in CHANGELOGs, docs, skills, llms files, code comments or test names.
4. Run only the test files you added or changed for that item when you need to see them pass. Do not run
   the whole suite per item.
5. Commit on `release/5.31` with a conventional message (the commit message may cite the item id).
6. Write `.tmp/bridge/to-claude/NNNN-<item>.md`: the item, commit sha(s), files changed, tests added and
   whether you ran them, open questions. Set the item to `ready-for-review` in `STATUS.md`, then move on to
   the next item without waiting.
7. When a `to-codex/` review ends in `VERDICT: CHANGES REQUESTED`, fix each numbered change in new commits,
   then write `to-claude/NNNN-<item>-fixes.md` mapping each change to its commit. `VERDICT: APPROVED`
   means set the item to `approved`.
8. If you are blocked or need a decision, write `to-claude/NNNN-question-<slug>.md`, mark the item
   `blocked` in `STATUS.md`, and take the next item.

## 4. Bridge rules

- File names are `NNNN-<slug>.md`, with a four-digit counter per folder (`0001-…`, `0002-…`).
- Never edit or delete a file once written; send a new one instead.
- Never write into `to-codex/` (that folder is Claude's).

## 5. Finish

When every item is `approved` (or `blocked (owner)`), run the full verification pass from the brief:
frozen install, `pnpm typecheck`, the strictness gate, and the full test run without queue. Write
`to-claude/NNNN-final-pass.md` with the results, and stop.

Start now with section 1, then item M1.
