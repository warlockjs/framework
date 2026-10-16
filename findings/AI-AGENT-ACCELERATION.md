# Making Warlock.js faster to build with for AI agents

Proposals for the owner, not approved work. Codex does not implement these unless the bridge says so.

## What slowed agents down in the 5.30 cycle

Every item below comes from something that actually happened while agents built and reviewed 5.30:

- **They had to guess the shape of runtime values.** The rate-limit store was written and unit-tested
  against the shape the agent assumed `@fastify/rate-limit` passes; the real plugin passes a different
  one, and every route ended up sharing one counter. Reviewers wrote throwaway probe scripts to see what
  the framework really does.
- **Generated code broke the framework's own conventions.** The notifications scaffold used
  `request.all()`, a six-handler controller, no resource and no locale keys, and later answered 404 on
  MongoDB because of a string/number id mismatch.
- **Security mistakes were easy to make and only a review caught them:** an unbounded regex on logged
  input (ReDoS), OAuth codes left in log snapshots, `javascript:` redirect targets, newline injection in
  SSE fields, unbounded parallel tool calls.
- **The feedback loop was slow and noisy.** `tsc` on a large app needed 8–16 GB. Each package has its
  own scripts, one has its own prettier config, and some gates aren't in CI. Tests failed locally only
  because of Node, port or Redis differences, and agents had to tell those apart from real failures.
- **Upgrades were manual.** Every 5.30 breaking change (synchronous logger, request-log snapshot,
  concurrent tools) needed a human or agent to find and edit call sites.

## Proposals, by leverage

### P0 — Let agents ask the app instead of grepping it

1. **`warlock inspect --json`** — one command that prints the facts an agent needs, from the running
   registry rather than from source text:
   routes (method, path, name, middleware chain, validation schema as JSON Schema, response schema,
   auth requirement, rate limit, logging policy), models (table, columns and types, relations,
   resource), resources (output shape), config keys and types, events and listeners, pages (path,
   loaders, actions, layout chain), queues and jobs, scheduled tasks, installed `@warlock.js/*` versions.
   Stable, versioned JSON schema for the output. `warlock routes` and `generate.openapi` already hold
   most of the route half.
2. **`warlock mcp`** — the same data, plus actions, as an MCP server that `warlock dev` can start:
   `inspect.*` tools, `docs.search` (installed-version skills and docs only), `generate.*` with a dry-run
   diff, `test.run` (one file or the tests affected by a change), `requests.recent` from devtools
   (request, response, queries with N+1 flags, logs, timings), `db.schema`. Agents get answers in one
   call; the framework, not the agent, decides what is true for this app.
3. **`warlock check [--changed] [--json]`** — the single verify command an agent loops on: typecheck
   (incremental), framework lint (below), the tests affected by the changed files, and convention
   checks. One JSON result per problem: stable error code, `file:line`, a one-line fix hint, and the
   skill that explains it. Exit codes that mean "your code" versus "this machine" (missing Redis, busy
   port, Node version) so agents stop chasing environment failures.
4. **Stable error codes everywhere.** Every framework error carries a code, a short "what to do", and a
   docs/skill link; `warlock explain <CODE>` prints the fix. `doctor --json` uses the same codes.

### P0 — Make the safe way the default way

5. **`@warlock.js/eslint-plugin`, preinstalled in the template**, encoding the conventions and the
   security lessons:
   - no `request.all()` passed to queries, services or `inApp` calls; use `request.validated()`;
   - a mutating route needs an auth guard or an explicit `public: true`;
   - `redirect()` and `<Link to>` with request input need an allowlist helper;
   - no logging of raw emails, tokens or request bodies outside the redaction helpers;
   - no unbounded quantifiers in regexes applied to request input (a simple lint is enough to flag them);
   - `await log.*` is unnecessary; one controller per file; `type` not `kind` for discriminators;
     no `.js` import extensions.
   Each rule links to its skill and has an autofix where possible.
6. **Secure-by-default primitives** for the remaining sharp edges: a `gate()`/`authorize()` that mutating
   resources require, rate-limit defaults on auth routes, typed and validated config at boot with clear
   errors, output escaping helpers for SSE, headers and logs.

### P1 — Generate correct code, then keep it correct

7. **Spec-first generators.** `warlock make endpoint --schema ./schema.ts --resource Post` writes the
   route, a controller per handler, validation, resource, locale keys, a test that hits the real HTTP
   stack, and the OpenAPI entry — following the conventions the lint enforces. Every `make`/`add`
   supports `--dry-run --json` (files it would write, files it would skip because they exist). The
   existing zero-edit generator matrix extends to these.
8. **A test kit built for agents.** `actingAs(user)` and a standard login helper; model factories;
   mail, queue, cache, storage and clock fakes on by default in the test environment; ephemeral ports;
   helpers that run the real Fastify plugins (so tests can't drift from real shapes); deterministic ids
   and time; response snapshot assertions. `warlock test --changed`.
9. **Codemods for every breaking change.** `warlock upgrade --to 5.31` applies the mechanical edits
   (ts-morph), prints what it could not do, and links the upgrade skill. The changelog lists the codemod
   next to each **BREAKING** entry.
10. **Typecheck speed is agent speed.** Cut seal's type cost (the benchmark now exists), keep a budget in
    CI, offer `warlock typecheck --changed`, and ship project-reference-friendly templates.

### P2 — Close the loop at runtime

11. **`warlock trace <method> <url> [--body]`** — sends a request to the dev server and prints the
    devtools timeline as JSON (middleware, validation result, queries, logs, response). Agents verify
    behaviour without a browser.
12. **An app-specific `AGENTS.md` kept fresh by `warlock dev`**, generated from `inspect`: modules, routes,
    conventions in force, which skills apply, how to run checks. agent-kit already syncs skills; this
    adds the app's own facts.
13. **Agent collaboration support in agent-kit.** The Codex ↔ Claude bridge used for 5.31 (task board,
    append-only messages, review verdicts) could become an `agent-kit` feature: `agent-kit board` to
    create and update items, and a watcher that notifies the reviewing agent.

## Suggested order

1. `inspect --json` and stable error codes (small, unlock everything else).
2. `check --json` with the environment/your-code split, and the ESLint plugin.
3. The test kit (`actingAs`, fakes, real-plugin helpers).
4. `mcp`, spec-first generators, codemods.
5. `trace`, generated `AGENTS.md`, agent-kit board.
