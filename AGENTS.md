# AGENTS.md

Instructions for AI agents working in the Warlock.js framework monorepo.
agent-kit derives each agent's guide (CLAUDE.md, etc.) from this file.

## Layout

- `packages/<name>` — one published package each (`@warlock.js/<name>`, plus `create-warlock`).
- `docs/` — the documentation site (Astro + Starlight), deployed to warlock.js.org.
- `tools/release/` — the release runner (npm-managed, outside the pnpm workspace).
- `scripts/` — workspace-wide checks. `skills/` — playbooks for this repository.
- `code-map/` — generated map of the code and docs (`FILE_INDEX.md`: which file holds what;
  `GRAPH_REPORT.md`: overview). Read it before searching; refresh with `pnpm code-map`.
  How to query it: `skills/navigate-the-code-map/SKILL.md`.

## Rules

- Install once at the root with `pnpm install`. Packages link to each other from
  this repository (`linkWorkspacePackages: true`), never from npm.
- Run a package's tools from inside that package: vitest resolves `include`
  globs against the current directory, and a run that finds no test files
  exits 0. `cd packages/<name>` first, or use `pnpm --filter <name> <script>`.
- Every code change ships with its tests, docs and a `CHANGELOG.md` entry in the
  same change.
- No `.js` extensions in import paths. Use `type`, never `kind`, for discriminators.
- Never present Warlock.js as following another framework. Public text (docs,
  changelogs, skills, release notes, code comments) describes our APIs on their
  own terms: no "Laravel calls this …", "Laravel-style", or "matches Rails".

## Releases

- Patch and minor releases are pre-approved by the owner. When the owner has asked
  you to work on a release, or another agent or app session has reported bugs for
  you to fix, publish the patch or minor release yourself as soon as the full
  verification and the release gate are green. Don't stop to ask for approval and
  never hand the publish command back to the owner.
- Major releases still need the owner's explicit go-ahead.

## Devtools preview

- The owner reviews devtools and Grimoire UI changes on a private preview before
  the final verify pass: a large real app running on the local packages of this
  repository, behind a password. Its address and folder are in the git-ignored
  root `.env` (`DEVTOOLS_PREVIEW_URL`, `DEVTOOLS_PREVIEW_HOME`); the setup, start,
  stop and rebuild scripts are described in the `README.md` inside
  `DEVTOOLS_PREVIEW_HOME`. Never write the address into tracked files.
- For UI feedback rounds, edit the UI, refresh the preview (a dashboard rebuild or
  a reload), and send the owner the link. Don't run typechecks or test suites
  between rounds; run them once, after the owner approves the changes.
- Keep the preview running between rounds. Stop only its own recorded process
  group, never by name or port.

## Skills

Reusable playbooks live in `skills/<slug>/SKILL.md` and are synced into every
agent's skills directory by `agent-kit sync`.
