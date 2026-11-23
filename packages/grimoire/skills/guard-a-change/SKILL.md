---
name: guard-a-change
description: "Keep a change inside its task and prove it with `warlock grimoire guard`: files outside the task, deleted proving tests, removed criteria, locked tests, protected areas, the public API snapshot, the code rules and a task id in every commit. Use before you stop work on a task, in CI, and when `GR7006`-`GR7013`, `GR3007`-`GR3010`, `GR4011`, `GR4012` or `GR9008` appear."
---

# Guard a change

The Grimoire is experimental: its file structure and commands may still change.

Agents drift: they remove, change or add things nobody asked for. The guard compares your diff with the task and says what the task did not ask for. Run it before you stop.

```bash
npx warlock grimoire guard            # the one task in progress
npx warlock grimoire guard T-12       # a task by number (T-12, 12 and T-012 match the same task)
npx warlock grimoire guard T-12 --base origin/main
npx warlock grimoire guard --base origin/main --commits origin/main..HEAD   # CI
npx warlock grimoire guard --hook     # agent hook: findings on stderr, exit code 2 on an error
npx warlock grimoire guard --json
```

It never boots the app. The change is the diff from the base (default: where your branch left the default branch) to the working tree, including staged, unstaged and untracked files. Exit code 0 means no error, 1 an error, and with `--hook` 2 (and 0 when it cannot run, such as no task).

## What it checks

| Code | What |
| --- | --- |
| `GR7006` | A changed file is outside the task: not owned by its feature (or `Features:`), not a file its flow reaches, not a test proving its criteria, not in `Files:`. |
| `GR7007` | A flow, criterion or case in `grimoire/features/` is gone and `Removes:` does not name it. |
| `GR7008` | A `@proves` test is gone and no other test proves that criterion, and `Removes:` does not name it. |
| `GR7009` | A file in `Locked:` was changed, renamed or deleted. |
| `GR7010` | A changed test has fewer assertions than at the base (`expect(`, `expect.soft(`, `assert(`, `assert.x(`, `.should(`; a warning). |
| `GR7011` | A protected area changed and the task's `Touches:` does not name it. |
| `GR7012` | A commit of `--commits` names no task (`T-12`), or a task that has no file. Merge commits are skipped. |
| `GR7013` | `grimoire check` warns when the routes differ from the approved API (the guard raises `GR7011` for `public-api`). |
| `GR3007`-`GR3010` | The code rules, on the lines the change adds. |
| `GR4011`, `GR4012` | An added `.only` or `.skip` (both errors in the guard). |
| `GR9008` | No task: pass one, name it in a commit, or have exactly one task `in progress`. |
| `GR9009` | Git could not answer: run in a repository, pass a base that exists, fetch the full history in CI. |

It also prints the changes that are not approved (`not approved: <n> changes`, from the approved baseline and the screenshots). They do not fail the guard; list them in your report.

## The task body fields

```md
- Files: src/app/shared/utils/money.ts, src/config/catalog.ts
- Features: orders, catalog/wishlist
- Locked: src/app/catalog/tests/wishlist.test.ts
- Touches: migrations, dependencies
- Removes: catalog/wishlist AC-3, catalog/wishlist case duplicate
```

Add a line only when the owner agreed; otherwise change the code. A path with no wildcard matches itself and everything under it; `**` crosses folders, `*` stays inside one.

## Protected areas

`migrations`, `auth`, `config`, `lockfile`, `dependencies` and `public-api` (`DEFAULT_PROTECTED_AREAS`). `dependencies` fires only when a `package.json` adds or changes a dependency entry, not for every edit of the file. `public-api` is the difference between the routes and `grimoire/approved/api.json`; approve a deliberate change with `npx warlock grimoire approve api` (it reads the cached route facts, so run `warlock grimoire build` first). Add or replace areas in `grimoire/settings.md`:

```md
---
protected:
  - payments src/app/payments/** src/config/payments.ts
---
```

## The code rules

`rules:` in `grimoire/settings.md` names the rules `grimoire check` runs on every file (`CODE_RULES`: `logical-css`, `specific-errors`, `type-discriminator`, `no-js-imports`). With no `rules:` key, `check` runs none and the guard runs all four on added lines; `rules: []` turns them off.

| Rule | Code | Flags | Write instead |
| --- | --- | --- | --- |
| `logical-css` | `GR3007` | `margin-left`, `padding-right`, `left:`, `text-align: left`, `float: right`, `border-left`, Tailwind `ml-4` `pr-2` `left-0` `text-left` `rounded-l-lg` `border-r` (with variants and `-` prefixes), style keys `marginLeft`, `textAlign: "left"` | `margin-inline-start`, `inset-inline-start`, `text-align: start`, `ms-4`, `pe-2`, `start-0`, `text-start`, `rounded-s-lg` |
| `specific-errors` | `GR3008` | a string that is only "Something went wrong", "An error occurred", "Unknown error", "حدث خطأ ما"…, in code and locale files (`error` and `oops` alone in locale values) | say what failed and what to do next, mapped from the error code |
| `type-discriminator` | `GR3009` | `kind: "a"`, `kind?: "a" \| "b"` | `type: "a"` |
| `no-js-imports` | `GR3010` | relative `import`/`export … from`/`import()` paths ending `.js`, `.jsx`, `.mjs`, `.cjs` | `./orders.service` |

Escape hatch, in a comment on the line or the line above, with a reason: `grimoire-allow logical-css: the code block reads left to right`. Spec files, `node_modules`, `dist` and `grimoire/` are skipped. The scanner reads text, not a syntax tree: JSX text with an apostrophe, regular expressions and your own assertion helpers are read loosely, and editors show no squiggles for these rules.

## When it fails

1. Read each finding: the file and line, then the task it is outside of.
2. Undo what the task did not ask for. Do not edit a locked test, delete a proving test, or add `.skip`.
3. If the file really belongs to the task, add it to `Files:` (or the feature to `Features:`) and say why in the task body, with the owner's agreement.
4. Run the guard again until it prints `guard: ok`.

In CI the scaffold's `.github/workflows/grimoire-guard.yml` runs it on every pull request; the `Stop` hook in `.claude/settings.json` runs `warlock grimoire guard --hook` when an agent finishes.
