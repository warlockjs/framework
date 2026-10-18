# Roadmap decided for 5.32 – 5.34

Owner decisions (2026-10-18). Work items for the next three releases; nothing here is optional.

## 5.32.0 — TypeScript 7

- Upgrade TypeScript to the latest stable (7.0.2, the native Go compiler) in the monorepo and in the
  create-warlock template: `tsc`/typecheck scripts, the dev-server type checker, `warlock typecheck` /
  `warlock check`, vitest typecheck.
- TypeScript 7's npm package no longer exports the classic JS compiler API (only `version` and `unstable/*`).
  Code that imports it — core's dev server (type generator, module loader, import parser, config reader,
  translation-key extraction, TS health checker), `warlock check` conventions, `run-typecheck`, `inspect`,
  doctor checks, tests, and the release gates (skill-snippet, strictness, consumer flags) — keeps the API through
  a pinned TypeScript 6.0.3 (last release with the JS API, same config rules as 7) declared as those packages' own
  dependency, so apps can install TS 7 for `tsc` without breaking the framework.
- Remove options TS 7 dropped: `baseUrl` (use `paths` relative to the tsconfig), `moduleResolution: node`/`node10`
  (use `bundler` or `nodenext`) in every package, the template and generator stubs; fix new diagnostics.
- Re-check tools that read TypeScript output: seal `bench:types` (instantiation counts), strictness gate,
  snippet gate, ts-morph codemods, typescript-eslint in the template's ESLint mode.
- Benchmark recorded 2026-10-18 on this server (TS 5.9.3 → 7.0.2, same configs, identical 0 errors):
  core 20.5 s / 1.69 GB → 4.0 s / 2.02 GB (default parallel checkers) or 6.9 s / 1.53 GB (`--checkers 1`);
  ai 12.9 s / 1.01 GB → 1.6 s / 0.94 GB. Speed is the win; memory is not — large apps still need program
  splitting (project references / per-module typecheck) to cut RAM.

## 5.33.0 — Oxlint/Oxfmt as the full replacement

- Oxlint + Oxfmt become the only default toolchain for the monorepo and new apps (create-warlock default
  `--lint oxc`), covering everything ESLint + Prettier did (framework conventions already live in
  `warlock check`).
- ESLint and Prettier support is switched off by default: `--lint eslint`, the dev-server ESLint checker and
  Prettier formatting still work when explicitly enabled but print a deprecation warning that names 5.34.0 as the
  removal release and the migration steps.
- `warlock upgrade` codemod / doc to migrate an app from ESLint + Prettier configs to Oxlint + Oxfmt.

## 5.34.0 — Removal

- Remove ESLint and Prettier support entirely: create-warlock's ESLint mode, the dev-server ESLint checker,
  Prettier/ESLint dependencies and configs in the monorepo and template, docs and skills that describe them.
