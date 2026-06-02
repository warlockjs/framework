# 2026-05-22 — Core docs restructure (Docusaurus + skills + llms.txt)

**Status:** in-progress
**Started:** 2026-05-22
**Context:**

- `domains/cascade/docs/` — gold-standard reference structure (Diátaxis: getting-started → essentials → guides → recipes → reference). Mirror tone + frontmatter conventions; diverge only where core's larger surface demands it.
- `domains/cascade/scripts/generate-llms-txt.mjs` — llms.txt generator. Fork for core; extend with a `llms-full.txt` concat pass.
- `domains/cascade/skills/groupby-aggregates/SKILL.md` — per-task folder skill pattern. Adopted.
- `@warlock.js/ai/skills/SKILL.md` — root+subskills hub-and-spoke pattern. **Rejected** for core in favor of cascade's flat per-task folders.
- `domains/core/marketing.md` — positioning ("AI-first backend framework, with strict app structure"). Intro page must own this; no flat feature lists.
- `domains/core/how-it-works/how-does-dev-server-work.md` — internal architecture. Stays internal; out of user docs.
- `domains/core/backlog.md` — feature backlog (Swagger/Postman/OpenAPI from routes).
- `@warlock.js/core/src/<subsystem>/README.md` — per-subsystem internal maps. Raw material for guide pages; do **not** copy verbatim (they're internal-flavored — translate to engaging user voice).
- `AGENTS.md` — domain folder rules + plan format.

## Why now

Cascade has a docs site that works. Ai has skills that work. Core is the largest package in the ecosystem and has neither a Docusaurus-ready docs tree nor a skills folder. Two consequences:

1. **No on-ramp.** A new developer has no path from "I want to try Warlock" to "I built an endpoint." The package README points at warlock.js.org but the site has no core content yet.
2. **AI assistants over-grep.** Without skills, an assistant editing a Warlock module has to discover every convention from source — slow, error-prone, drift-inducing.

This plan closes both gaps in one initiative, vertical-slice rollout (Slice 1 ships a working hello-world path; later slices grow outward).

## Mental model — the spine

User-facing docs organize around the request lifecycle:

```
bootstrap → connectors start → router serves request →
  controller validates → use-case runs pipeline →
  repository accesses data → resource shapes response
```

Side subsystems (mail, storage, cache, encryption, image, retry, socket, benchmark, cli) hang off the spine in `guides/`. Internals (dev-server, production, manifest, container, generations) stay out of user docs except a single "how it works" page that links to `domains/core/how-it-works/`.

## Decisions locked

1. **Docs title:** "Warlock.js" with `@warlock.js/core` as subtitle/import line. Marketing positioning trumps cross-package title symmetry with cascade.
2. **Internals excluded:** dev-server, production, manifest, container, generations are NOT in user docs (one `guides/how-it-works.md` links to `domains/core/how-it-works/`).
3. **Essentials covers both controllers and use-cases:** controllers primary; use-cases as the pipeline they call.
4. **Repositories docs live in core** for now. Re-home cheap if extracted.
5. **Reference is hand-written** (cascade's `query-builder-api.md` pattern). No TypeDoc.
6. **`llms.txt` generator forked** to `domains/core/scripts/generate-llms-txt.mjs`. Adds `llms-full.txt` (page H1 + body, separated by `---`).
7. **Skills at `@warlock.js/core/skills/`**, flat per-task folders, **verb-noun naming, unprefixed**.
8. **One `warlock-conventions/SKILL.md`** at top of `skills/` holds framework-wide invariants. Task skills link to it; do not repeat conventions per-skill.

## Target structure

### `domains/core/docs/`

```
README.md                             top-level docs index
llms.txt                              generated
llms-full.txt                         generated
getting-started/
  01-introduction.md                  Warlock = AI-first backend; the spine in 30s
  02-installation.md                  create-warlock + tsconfig + layout
  03-configuration.md                 warlock.config.ts + src/config/* + env
  04-first-route.md                   working GET → JSON, <5 min
  05-project-layout.md                src/app/<module>/ convention
essentials/
  01-the-request-lifecycle.md
  02-routing.md
  03-controllers.md
  04-use-cases.md
  05-repositories.md
  06-resources.md
guides/
  application, bootstrap-and-connectors, configuration-deep,
  warlock-config, routing-deep, http-request, http-response,
  middleware, file-uploads, validation, use-cases-deep,
  repositories-deep, resources-deep, restful, mail, storage,
  cache, encryption, image-processing, logging, socket, retry,
  benchmark, testing, cli-commands, generators, how-it-works
recipes/
  add-a-crud-module, protected-routes, custom-cli-command,
  custom-connector, custom-validator, upload-to-s3,
  transactional-email, api-versioning, localized-responses,
  cached-list, rate-limiting, soft-delete-restful, integration-tests
reference/
  exports, request-api, response-api, router-api, use-case-api,
  repository-api, resource-api, application-api, config-api,
  cli-commands, errors
```

5 getting-started + 6 essentials + 27 guides + 13 recipes + 11 reference = **62 doc pages**.

### `@warlock.js/core/skills/`

```
warlock-conventions/SKILL.md          framework-wide invariants (load first)
create-module/SKILL.md
register-route/SKILL.md
create-controller/SKILL.md
send-response/SKILL.md
write-middleware/SKILL.md
validate-input/SKILL.md
upload-file/SKILL.md
write-use-case/SKILL.md
use-repository/SKILL.md
define-resource/SKILL.md
build-restful/SKILL.md
configure-app/SKILL.md
send-mail/SKILL.md
store-file/SKILL.md
use-cache/SKILL.md
write-cli-command/SKILL.md
add-connector/SKILL.md
benchmark-code/SKILL.md
retry-operation/SKILL.md
hash-password/SKILL.md
use-app-context/SKILL.md
test-http/SKILL.md
```

**23 skills** (1 conventions + 22 task skills). Each frontmatter carries its own `name`, `description`, `when_to_use` per the cascade `groupby-aggregates` pattern.

## Conventions for every doc page

- Frontmatter: `sidebar_position`, `sidebar_label`, `description`.
- Voice: engaging, mental-model first, no marketing fluff (memory: docs-voice-engaging).
- Hide framework internals from user docs (memory: docs-hide-internals).
- Canonical imports — match the real package source, not the re-exports through core (memory: docs-canonical-imports).
- Verify every API claim against source (memory: docs-no-drift-verify-source). Docblocks are aspirational; trace the real code path.
- Cross-link guides ↔ reference ↔ skills using the cascade pattern: guide page links to its `recipes/*` and `reference/*` neighbors; skill links to its docs guide.

## Tasks — vertical slices

### Slice 1 — Hello World runs

Acceptance: a new developer reads getting-started (5 pages) + 3 task skills, then builds a working endpoint without help. `llms.txt` + `llms-full.txt` already generated and link-clean.

- [x] `domains/core/README.md` — domain index (per AGENTS.md folder-README rule)
- [x] `domains/core/docs/README.md` — top-level docs index (cascade pattern)
- [x] `domains/core/docs/getting-started/01-introduction.md`
- [x] `domains/core/docs/getting-started/02-installation.md`
- [x] `domains/core/docs/getting-started/03-configuration.md`
- [x] `domains/core/docs/getting-started/04-first-route.md`
- [x] `domains/core/docs/getting-started/05-project-layout.md`
- [x] `@warlock.js/core/skills/warlock-conventions/SKILL.md`
- [x] `@warlock.js/core/skills/register-route/SKILL.md`
- [x] `@warlock.js/core/skills/create-controller/SKILL.md`
- [x] `@warlock.js/core/skills/send-response/SKILL.md`
- [x] `domains/core/scripts/generate-llms-txt.mjs` — forked from cascade, adds `llms-full.txt` pass
- [x] `domains/core/docs/llms.txt` + `llms-full.txt` — first generation
- [/] Cross-link audit Slice 1 pages (pending Hasan review)

### Slice 2 — Essentials + first CRUD module

Acceptance: developer builds a real CRUD module end-to-end from essentials + matching skills + the recipe.

- [x] `essentials/01-the-request-lifecycle.md`
- [x] `essentials/02-routing.md`
- [x] `essentials/03-controllers.md`
- [x] `essentials/04-use-cases.md`
- [x] `essentials/05-repositories.md`
- [x] `essentials/06-resources.md`
- [x] Skills: `create-module`, `write-use-case`, `use-repository`, `define-resource`, `validate-input`, `write-middleware`
- [x] `recipes/add-a-crud-module.md`
- [x] Regenerate `llms.txt` + `llms-full.txt`

### Slice 3 — High-traffic adjacent subsystems

Acceptance: top adjacent subsystems all have guide + skill + at least one recipe each where it helps.

- [x] Guides: `mail`, `storage`, `cache`, `validation`, `file-uploads`
- [x] Skills: `send-mail`, `store-file`, `use-cache`, `upload-file`
- [x] Recipes: `upload-to-s3`, `transactional-email`, `cached-list`
- [x] Regenerate `llms.txt` + `llms-full.txt`

### Slice 4 — Long-tail guides + remaining skills

Acceptance: every public subsystem documented; corresponding skill exists where the task surface justifies one.

- [x] Guides: `encryption`, `image-processing`, `retry`, `benchmark`, `logging`, `socket`, `cli-commands`, `generators`, `application`, `bootstrap-and-connectors`, `configuration-deep`, `warlock-config`, `routing-deep`, `http-request`, `http-response`, `middleware`, `use-cases-deep`, `repositories-deep`, `resources-deep`, `restful`, `how-it-works`
- [~] Guides: `testing` — **postponed** (framework core lacks internal unit tests today; revisit when those land)
- [x] Skills: `hash-password`, `benchmark-code`, `retry-operation`, `write-cli-command`, `add-connector`, `use-app-context`, `configure-app`, `build-restful`
- [~] Skills: `test-http` — **postponed** alongside `guides/testing.md`
- [x] Recipes: `custom-cli-command`, `custom-connector`, `custom-validator`, `api-versioning`, `localized-responses`, `rate-limiting`, `soft-delete-restful`, `protected-routes`
- [~] Recipes: `integration-tests` — **postponed** alongside `guides/testing.md`
- [x] Regenerate `llms.txt` + `llms-full.txt`

### Slice 5 — Reference + polish

Acceptance: every essentials/guides page has a reference counterpart; zero broken links; plan moves to archive.

- [ ] All `reference/*.md` pages (deferred — Hasan prefers usage docs over API reference; revisit after consumer feedback)
- [ ] Cross-link audit across docs + skills
- [ ] Final `llms.txt` + `llms-full.txt` generation
- [ ] Update `domains/core/README.md` with completion note
- [ ] Move this plan to `domains/core/plans/archive/`

## Open items

- **Testing pages postponed** (`guides/testing.md`, `recipes/integration-tests.md`, `skills/test-http/SKILL.md`). Reason: framework core has no internal unit-test coverage yet; consumer-facing testing docs would ship ahead of the framework's own test maturity. Revisit once core has its own test surface.
- **Reference tier deferred.** Hasan called for usage docs, not API reference. Will revisit if consumers ask for it.
- **API drift caught during wave 1 and patched.** Notable corrections: `config.get(name)` + `config.key(path)` (not `config(...)` as a function call); `setConfig` is not exported; `useCase({ retryOptions, benchmarkOptions })` (not `retries`/`benchmark`); encryption exports are `hashPassword`/`verifyPassword`/`encrypt`/`decrypt`/`hmacHash` (not a `password.*` namespace); Mail React templates use `.component(<X />)` (not `.react`); test mailbox helpers are named exports (`clearTestMailbox`/`getTestMailbox`/`findMailsTo`/`assertMailSent`); storage is the lowercase `storage` singleton with `storage.use(name)` (not `Storage.disk()`); validation uses `v.string().url()` (not `v.url()`); `latencyRange: { excellent, poor }` (not `up`/`down`); generators emit schemas to `schema/` (older `validation/` is historical); CLI surface is the `command()` factory + `CLICommand` (all-caps) export (older `CliCommandsManager`/`cliCommandsManager` mentions in `cli/README.md` are stale).
- **`repositoryStub` generator bug.** `templates/stubs.ts` references nonexistent `withDefaultOptions`/`withDefaultFilters` methods. `crudRepositoryStub` works correctly; `generate.repository` emits broken code today. Not a docs issue — flag for a framework fix.
- **`password.ts` JSDoc drift.** JSDoc cites `encryption.password.saltRounds` but runtime reads `encryption.password.salt`. Docs use the runtime key. Flag for framework cleanup.

## Summary

(Updated on completion.)
