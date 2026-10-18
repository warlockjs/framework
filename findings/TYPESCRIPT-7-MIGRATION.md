# TypeScript 7 migration verification

Branch: `claude/532-typescript-7`. Implementation: `0e1c253b` (`feat: adopt TypeScript 7 native compiler`). All commits carry the requested Codex co-author trailer. No family versions were bumped; changes are recorded under undated `## 5.32.0` changelog headings.

## Result and files

All 32 published packages, the root, docs, release tooling, and the application template directly pin `typescript` to **7.0.2**. The regular `tsc` command runs the native compiler. No native-preview package was added. Every requested final verification passes, including the existing strictness and snippet ratchets without allowance increases.

The implementation changes 175 files:

- Package manifests and applicable tsconfigs throughout `packages/`, the root, `docs/`, and `tools/release/`; root, docs, scaffolder, and release-tooling lockfiles. The two obsolete npm locks in `packages/ai` and `packages/ai-openai` were removed: these packages install from the root pnpm workspace, and their stale npm locks still described the old compiler.
- Core's new internal `src/tooling/typescript/compiler.ts` adapter and `src/tooling/syntax/` OXC helpers; the migrated consumers and their tests listed below.
- The AI import-graph spec, correctly constructed tool fixtures in AI/provider specs, and an auth localization fixture's guarded regex capture.
- Seal's benchmark runner and baseline; the web acceptance fixture's generated tsconfig; scaffold config and a CSS side-effect module declaration.
- Current installation/configuration/scaffolder documentation, the TypeScript 7 guide, upgrade/scaffolder skills, and each touched package's changelog.

Added runtime dependencies are `oxc-parser@0.154.0` and `jsonc-parser@3.3.1` in core. AI uses OXC as a development dependency for its graph spec; release tooling uses JSONC parsing. The OXC pin was checked against npm's current version before installation.

Removed compiler options include `baseUrl`, classic `node`/`node10` resolution, `downlevelIteration`, and the obsolete deprecation setting. Alias targets are config-relative. Node ambient types and source roots are explicit. Shipped source remains strictly checked; no suppression or `any` escape was added.

## Compiler API migration table

Core paths in this table are relative to `packages/core/`; other package paths are written in full.

| File | New mechanism |
| --- | --- |
| `src/tooling/typecheck/run-typecheck.ts` | Native `tsc --noEmit --incremental --tsBuildInfoFile`; parse plain diagnostics. Changed-file filtering resolves direct importers through the native Checker. |
| `src/dev-server/health-checker/checkers/typescript-health-checker.ts` | Long-lived native `API` session through `CompilerSession`; updated snapshots and per-file diagnostics. |
| `src/dev-server/health-checker/workers/ts-health.worker.ts` | One native session per worker; virtual source updates/deletions; closes its own compiler on shutdown. |
| `src/dev-server/type-generator.ts` | OXC syntax traversal. Existing type names and keys are syntactic; no semantic checker was needed. |
| `src/dev-server/model-resource-typings.ts` | OXC classes, imports, exports and static resource declarations; preserves conservative skipping. |
| `src/dev-server/parse-imports.ts` | OXC comment ranges, preserving regex/template/JSX behavior. Existing module-lexer/resolution paths remain. |
| `src/dev-server/read-config-ast.ts` | Parse one OXC syntax tree; parent/source metadata held in weak maps. |
| `src/dev-server/extract-translation-keys.ts` | OXC calls and literal object properties; computed keys remain excluded. |
| `src/dev-server/module-loader.ts` | Pass OXC source trees to translation extraction. |
| `src/generations/features/shared/merge-web-sitemap-config.ts` | OXC positions for source splicing and OXC syntax validation. |
| `src/cli/commands/doctor/checks/locales-ts-deprecated.check.ts` | OXC import/call/literal validation and syntax diagnostics. |
| `src/tooling/check/source-ast.ts` | OXC scope, binding, reference, parent and source-position helpers. |
| `src/tooling/check/security-conventions.ts` | OXC traversal with the existing security findings and taint rules. |
| `src/tooling/check/code-style-conventions.ts` | OXC calls, declarations and type-member annotations. |
| `src/tooling/check/request-input.ts` | OXC expressions and local initializer analysis. |
| `src/tooling/check/conventions-step.ts` | OXC import references and JSONC config parsing. |
| `src/tooling/inspect/collect-pages.ts` | OXC exports and declarations. |
| `src/database/no-auth-import.spec.ts` | OXC static/type/dynamic/require import references. |
| `src/dev-server/extract-translation-keys.spec.ts` | OXC source trees. |
| `src/dev-server/type-generator.config-keys.spec.ts` | OXC syntax diagnostics and property assertions. |
| `src/tooling/check/code-style-conventions.spec.ts` | OXC source spans. |
| `src/tooling/check/security-conventions.spec.ts` | OXC source spans. |
| `tests/unit/cli/generated-endpoint-types.test.ts` | Native API snapshot with virtual files/config, checking actual workspace source. |
| `tests/unit/cli/generated-notifications-stub-types.test.ts` | Native API virtual compilation, retaining the negative control. |
| `tests/unit/dev-server/read-config-ast.test.ts` | Assertions on OXC statements and parent metadata. |
| `tests/unit/dev-server/ts-health-worker-configured-roots.test.ts` | Real native source/published workers and inline fallback; behavioral diagnostic assertions and explicit shutdown. |
| `tests/unit/generations/stub-handler-signature.test.ts` | OXC arrow parameters and object patterns. |
| `packages/ai/src/security/core-import-graph.spec.ts` | OXC runtime-reference traversal, excluding type-only/unused imports. |
| `tools/release/scripts/skill-snippet-gate.ts` | Native `tsc` per compile group; per-skill dependency/alias directories preserve isolation; JSONC parsing. |
| `tools/release/scripts/strictness-gate.ts` | Resolve native `tsc` from the TypeScript package's bin manifest; existing output-based ownership/coverage and unchanged allowances; JSONC parsing. |
| `tools/release/scripts/consumer-strictness-flags.ts` | JSONC parser; retains the existing compiler-flag allowlist. |

Only `packages/core/src/tooling/typescript/compiler.ts` imports the unstable TypeScript API. A final grep found no remaining classic `from "typescript"`, `require("typescript")`, or `import("typescript")` consumers in the requested trees.

## Compatibility exceptions and limits

There is no application/compiler fallback to TypeScript 5 or 6. Two third-party parser/tooling exceptions remain explicit:

1. **Optional ESLint/Prettier tooling requires the classic JavaScript API.** Under TS7, four scaffold specs failed with `TypeError: Cannot read properties of undefined (reading 'Intrinsic')` at `ts-api-utils/lib/index.cjs:779`, loaded by `@typescript-eslint/type-utils`. TS7's main entry has no `TypeFlags`, parser, or language-service API; this cannot be repaired by changing app source or tsconfig. Root and standalone scaffolder `pnpm-workspace.yaml` files explicitly give those external tools their own **5.9.3** runtime dependency via `packageExtensions`. Verified runtime resolution: scaffolder `typescript.version = 7.0.2`, ESLint's private `typescript.version = 5.9.3`. All ESLint scaffold specs pass again. Generated apps still pin TS7; docs explicitly state that the optional ESLint mode does not support TS7's removed API and recommend Oxlint/Oxfmt. Deprecation remains scheduled for 5.33, removal for 5.34. No default-toolchain switch was brought forward.
2. **ts-morph 28.0.0 bundles TypeScript 6.0.2 internally.** Verified `tsMorph.ts.version`. Its parser/transformer is self-contained, separate from `tsc`, and does not consume the app's TS7 main export. Existing upgrade codemod specs pass beside TS7 and the migrated configs. Replacing that internal compiler would require porting the third-party library itself; it is not used for framework/app typechecking.

The initial release-tooling `npm install` crashed in npm's peer-tree resolver (`edgesOut`). Installation with `--legacy-peer-deps` produced the updated lockfile; a subsequent clean **default `npm ci` passed**, followed by passing script tests and TS7 checks. No permanent peer-check bypass was added.

Docs needs `astro sync` before compiling generated content types. No llms files were regenerated. The full published browser/production acceptance pipeline was not invoked; the changed acceptance fixture was syntax-checked and linted. This task's requested migrated specs and compiler gates were run.

## Measurements

`pnpm typecheck` passed for every published package with zero diagnostics in **36.491 seconds** in the final timed run. Another successful run took 42.923 seconds. No valid before/after wall-time comparison is claimed: the initial baseline run overlapped dependency installation and therefore mixed compiler versions near its end.

Seal's deterministic 16-entity/8-service benchmark:

| Metric | Previously committed TS 5.9.3 baseline | TS 7.0.2, one checker |
| --- | ---: | ---: |
| Files | 465 | 487 |
| Types | 266,088 | 266,344 |
| Instantiations | 653,057 | 655,949 |
| Memory (KB) | 664,909 | 449,848 |
| Check time (seconds) | 5.950 | 3.171 |
| Compiler total (seconds) | 6.680 | 3.237 |
| Errors | 0 | 0 |

Native parallel checkers maintain separate caches: an exploratory default-checker run reported 648,765 types and 1,593,776 instantiations. The benchmark now fixes `--checkers 1` rather than comparing those aggregate counts to the old baseline. Repeating `--check` reproduced **655,949 instantiations and 266,344 types exactly** (0.0% drift); time/memory are informational.

## Commands and final results

Compiler, install and test commands used Node **22.15.0**. No nvm default was changed, no port 3000 was bound, and no process-name/pattern kill was used. Compiler/worker shutdown only closes owned children.

| Working directory | Command | Result |
| --- | --- | --- |
| Root | `pnpm install` | PASS; updated root/docs lockfiles. |
| Root | `pnpm install --frozen-lockfile` | PASS after the final dependency/compatibility changes. |
| `packages/create-warlock` | `pnpm install` | PASS; updated the standalone lockfile. |
| `tools/release` | `npm ci` | PASS with the updated npm lockfile (default peer handling). |
| Root | `pnpm typecheck` | PASS; all 32 packages, zero errors; final wall time 36.491 seconds. |
| `docs` | `pnpm exec astro sync` | PASS; generated content types. |
| Root | `pnpm --filter @warlock.js/docs typecheck` | PASS under TS7. |
| `packages/core` | Core migrated-spec command below | PASS: 75 files, 682 tests. |
| `packages/ai` | `npx vitest run src/security/core-import-graph.spec.ts src/middleware/builtins/budget-reserve.spec.ts` | PASS: 2 files, 13 tests. |
| `packages/ai-openai` | `npx vitest run src/model-provider-options.spec.ts` | PASS: 9 tests. |
| `packages/ai-anthropic` | `npx vitest run src/model-provider-options.spec.ts` | PASS: 72 tests. |
| `packages/ai-bedrock` | `npx vitest run src/model-provider-options.spec.ts` | PASS: 3 tests. |
| `packages/auth` | `npx vitest run src/localization/auth-default-translations.spec.ts` | PASS: 13 tests. |
| `tools/release` | `npm run test:scripts` | PASS: 267 passed, 1 skipped, zero failures. Repeated after the clean install. |
| `tools/release` | Release compiler command below | PASS: zero TS7 diagnostics. |
| `packages/create-warlock` | `npm run test:standalone` | PASS: 24 files, 425 tests, including ESLint scaffolds and source/template format phases. |
| `packages/create-warlock` | `npx vitest run specs/template-typecheck.spec.ts` | PASS: 1 real compiler test. |
| `packages/create-warlock` | `npm run format:template` | PASS: 91 files. |
| Root | `node --import tsx tools/release/scripts/skill-snippet-gate.ts` | PASS ratchet: 787 blocks compiled, 766 passed, 21 failures within existing per-package allowances; 979 deliberate fragments skipped; zero type/path conflicts. |
| `tools/release` | `node --import tsx scripts/strictness-gate.ts` | PASS for every package and docs; no allowance increased. |
| `packages/seal` | `node scripts/bench-types.mjs --update` | PASS; TS7 single-checker baseline recorded. |
| `packages/seal` | `node scripts/bench-types.mjs --check` | PASS; zero compiler errors and 0.0% deterministic count drift. |
| Root | `pnpm -s format:check` | PASS. |
| Root | `pnpm -s lint:oxlint` | PASS: zero errors; 1,887 warnings reported. |
| Root | `node scripts/check-public-text.mjs` | PASS. |
| Root | `node --check packages/web/tests/acceptance/published-react-gate.mjs` | PASS; fixture also passed targeted Oxlint/Oxfmt. |
| Root | `git diff --check` | PASS. |

Core migrated specs (run from `packages/core`):

```bash
npx vitest run src/tooling/check src/tooling/typecheck src/tooling/typescript src/tooling/inspect src/dev-server tests/unit/dev-server tests/unit/generations/stub-handler-signature.test.ts tests/unit/cli/generated-endpoint-types.test.ts tests/unit/cli/generated-notifications-stub-types.test.ts src/cli/commands/doctor src/upgrade src/database/no-auth-import.spec.ts src/generations/features/shared/merge-web-sitemap-config.spec.ts
```

Release script compiler check (run from `tools/release`):

```bash
node node_modules/typescript/bin/tsc --noEmit --module esnext --moduleResolution bundler --target ES2022 --skipLibCheck --types node --strict --rootDir ../.. scripts/strictness-gate.ts scripts/skill-snippet-gate.ts scripts/consumer-strictness-flags.ts
```

Earlier failing iterations were resolved before these final results: four initial syntax/diagnostic differences, the published-worker test bundle dependency, TS7 Node/source-root defaults, missing CSS declarations, removed template compiler options, the ESLint API blocker above, and one unused release helper/formatting differences. New compiler tests cover incremental invalidation, aliased direct importers, CLI diagnostic chains, unsaved snapshot updates, and Unicode diagnostic columns.
