# Codex brief — implement Warlock.js 5.31.0

You are the implementer for 5.31.0. Claude (another agent on this server) reviews every item you finish
and sends you review notes through the bridge described below. The repository owner makes the final
calls. Read `AGENTS.md` first; its rules apply on top of this brief.

## Scope

Implement everything in:

1. `findings/NEXT-RELEASE.md` — all six sections (must-fix, unfinished from 5.30, code quality and
   tooling, skills, features, housekeeping). Some lines say "done on `main`": verify them and do what
   is listed as still open.
2. `findings/WR-028-*.md` to `findings/WR-032-*.md` — five reports from an app that upgraded to 5.30
   (SSE/stream wire control, `spawnSubAgent` tool dispatch, buildable Anthropic request bodies,
   URL-based log redaction, `<Form>` callbacks for failed and dropped submissions).
3. Anything Claude adds through `.tmp/bridge/to-codex/` while you work (new items or review changes).

Out of scope unless the bridge says otherwise: `findings/AI-AGENT-ACCELERATION.md` (proposals the owner
has not approved yet), version bumps, publishing, tags, and editing `tools/release` behaviour beyond what
an item asks for.

## Order

Work top to bottom; one item = one or more focused commits.

1. Must-fix list in `NEXT-RELEASE.md` §1 (Node 22.15 message in the CLI, create-warlock success box,
   release confirm window, internal-id gate).
2. WR-029, WR-032, WR-031, WR-028, WR-030 (smallest first).
3. `NEXT-RELEASE.md` §2 (unfinished from 5.30), then §3 (quality and tooling), §4 (skills), §5 (features),
   §6 (housekeeping).

## Rules

- **Branch.** Create `release/5.31` from `main` and work only there. Never commit to `main`, never push,
  never tag, never run `pnpm release:version`. Claude or the owner merges after review.
- **Every change ships with its tests, docs and a `CHANGELOG.md` entry** in the same commit, under the
  existing undated `## 5.31.0` heading (create it at the top of a package's CHANGELOG if missing, keep
  any BOM). Mark breaking changes **BREAKING** and add an Upgrading note.
- **No internal ids in public text.** Never write `WR-0xx`, `FW-xx` or the names of the apps that reported
  an issue in CHANGELOGs, docs, skills, llms files, code comments or test names. Describe the behaviour.
  (Commit messages may cite them.)
- **Code style.** No `.js` extensions in imports. Use `type`, never `kind`, for discriminators. Match the
  surrounding code. Run prettier on files you create and on files that were already prettier-clean;
  `packages/create-warlock` uses its own `.prettierrc.json`, which its `test` script enforces.
- **Skills and llms.** When a public API changes, update the package's skills and run its
  `scripts/generate-llms.mjs`.
- **Strictness ratchet.** `cd tools/release && node --import tsx scripts/strictness-gate.ts` must not go
  over any allowance; lower an allowance when you reduce a package's count.
- **Verification.** Don't run the whole suite after every item. Run only the test files you added or
  changed for that item when you need to see them pass. One full pass at the end (and whenever Claude
  asks): `pnpm install --frozen-lockfile`, `pnpm typecheck`, the strictness gate, then
  `CI=1 pnpm --recursive --filter "./packages/**" --filter "!@warlock.js/queue" --workspace-concurrency=1 --no-bail run test`.
- **Environment.** Use Node 22.15 (`export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh; nvm use 22.15.0`); pnpm
  11.24 comes from corepack inside the repo. Known local-only failures, not yours to fix: queue and
  notifications Redis tests (no Redis on 6390) and one core test that needs port 3000 free.
- **Don't guess Claude-API facts.** For Anthropic request shapes, thinking, model ids or beta headers, read
  the existing adapter code and its docs; if something is unclear, ask through the bridge.

## The bridge (how you and Claude talk)

A git-ignored folder at the repository root: `.tmp/bridge/`. Plain Markdown files, append-only.

```
.tmp/bridge/
  README.md          the protocol (same as this section)
  STATUS.md          the item board — you keep it current
  to-codex/          Claude → Codex: instructions and reviews   (you read, never edit)
  to-claude/         Codex → Claude: ready-for-review reports and questions   (you write)
```

- **File names:** `NNNN-<slug>.md`, four-digit counter per folder (`0001-…`, `0002-…`). Never edit or delete
  a sent file; send a new one instead.
- **Before you start each item, and after each commit**, read any `to-codex/` file you have not handled
  yet and act on it first. Record what you handled in `STATUS.md` ("handled to-codex up to 0003").
- **When an item is ready**, write `to-claude/NNNN-<item>.md` with: the item, the commit sha(s) on
  `release/5.31`, what changed (files), the tests you added and whether you ran them, and open questions.
  Then set the item to `ready-for-review` in `STATUS.md` and move on to the next item; don't wait.
- **Claude's reviews** arrive as `to-codex/NNNN-review-<item>.md` ending in `VERDICT: APPROVED` or
  `VERDICT: CHANGES REQUESTED` with numbered required changes (file:line, what, why). Fix them in new
  commits, then send `to-claude/NNNN-<item>-fixes.md` listing each numbered change and its commit.
- **Questions:** `to-claude/NNNN-question-<slug>.md`. If you are blocked, say so in `STATUS.md` and take
  the next item.
- **STATUS.md columns:** item · state (`todo` / `in-progress` / `ready-for-review` / `changes-requested` /
  `approved` / `blocked`) · commits · last bridge file.
- **Finish:** when every item is `approved`, run the full verification pass above, write
  `to-claude/NNNN-final-pass.md` with the results, and stop.
