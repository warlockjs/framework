# AGENTS.md

Instructions for AI agents working in the Warlock.js framework monorepo.
agent-kit derives each agent's guide (CLAUDE.md, etc.) from this file.

## Layout

- `packages/<name>` — one published package each (`@warlock.js/<name>`, plus `create-warlock`).
- `docs/` — the documentation site (Astro + Starlight), deployed to warlock.js.org.
- `tools/release/` — the release runner (npm-managed, outside the pnpm workspace).
- `scripts/` — workspace-wide checks. `skills/` — playbooks for this repository.

## Rules

- Install once at the root with `pnpm install`. Packages link to each other from
  this repository (`linkWorkspacePackages: true`), never from npm.
- Run a package's tools from inside that package: vitest resolves `include`
  globs against the current directory, and a run that finds no test files
  exits 0. `cd packages/<name>` first, or use `pnpm --filter <name> <script>`.
- Every code change ships with its tests, docs and a `CHANGELOG.md` entry in the
  same change.
- No `.js` extensions in import paths. Use `type`, never `kind`, for discriminators.

## Skills

Reusable playbooks live in `skills/<slug>/SKILL.md` and are synced into every
agent's skills directory by `agent-kit sync`.
