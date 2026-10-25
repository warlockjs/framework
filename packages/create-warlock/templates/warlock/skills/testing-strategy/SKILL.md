---
name: testing-strategy
description: "Vitest test scope, co-located service and endpoint specs when testing is enabled, isolation, boundary mocks, integration tests and flaky-test policy. Use when planning or reviewing test coverage. Use git-workflow instead for CI and merge gates."
---

# Testing strategy

**Status:** Stable
**Applies to:** Every test in the project, and every code change that should but doesn't have one.

Tests are insurance, not ceremony. The right tests prevent the right bugs at the right cost. Wrong-shape tests slow the team down and rot until everyone ignores them.

> **Sub-agent rule:** Before writing tests, read this file to decide what kind of test belongs here.

---

## 0. When this skill applies — and the mandate

This skill governs projects that have **opted into testing**. Testing is **enabled** when **either** is true:

- `package.json` has a `test` (or `test:*`) script, **or**
- a `vitest.config.*` / `vite.config.*` file exists at the project root.

When the `test` feature is selected at scaffold time, both land automatically (Vitest, `@vitest/coverage-v8`, and separate unit/integration projects with a per-file runtime by default).

### 0.1 If testing is enabled, tests are mandatory — not optional

- **Every service** ships a co-located unit spec: `place-order.service.ts` → `place-order.service.spec.ts`. Cover the happy path, every branch, and every error path. Mock the repository — the service's logic is the unit under test.
- **Every HTTP controller / request handler** ships a test: a unit test with mocked services for its branch / validation / authorization logic, **or** an integration test through the route when the wiring is the point. A new endpoint without a test is an incomplete endpoint.

Write the spec in the **same change** that adds the service or controller. A reviewer treats a missing spec as a blocking defect, not a follow-up.

### 0.2 If testing is NOT enabled

No `test` script and no vitest/vite config — e.g. a scaffold created without the `test` feature. **Do not** add tests or testing dependencies unprompted, and don't invent a `vitest.config`. If the project is outgrowing prototype stage, _suggest_ enabling the `test` feature — but never scaffold a suite the project didn't ask for.

---

## 1. The pyramid

```
        /\
       /  \      e2e        (~5%)  — slow, full system, critical journeys only
      /----\
     /      \   integration (~25%) — real DB / queue, exercises wiring
    /--------\
   /          \  unit       (~70%) — fast, isolated, pure logic
  /____________\
```

### 1.1 Unit — most of the suite

- Services with mocked repositories
- Utility functions (pure)
- Model getters, validators, computed fields
- Resource mappers
- Error class construction

Fast (< 50ms each), isolated (no I/O), pinned to a single function or class.

### 1.2 Integration — real wiring

- Services + real DB (via testcontainers)
- Repository queries against a real DB
- Queue producer + consumer wired together
- Auth flow through the framework's middleware

Medium (100ms–2s each), real dependencies, fewer than unit tests.

### 1.3 E2E — critical journeys

- "User can sign up and place an order"
- "User can log in, hit rate-limit, recover"
- Payment + webhook handshake

Slow (5–30s each), small number (10–30 per app), only for journeys whose breakage is a business-impacting incident.

### 1.4 The 70 / 25 / 5 split

Not enforced numerically. Enforced culturally — when a reviewer sees ten new e2e tests for one feature, they push back.

---

## 2. What to test, what not to

### 2.1 Test

- **Public surface of a module** — services, controllers, resources, models' public methods
- **Branches and edge cases** — every `if` / `else` worth its salt has a test
- **Error paths** — what happens when the dependency fails / the input is invalid / the user lacks permission
- **Security-sensitive logic** — auth, authorization, input validation, rate limiting
- **Money and time arithmetic** — these break silently; tests are the only safety net
- **Business rules** — anything where "the spec says X" matters more than "the code does Y"

### 2.2 Don't test

- **The framework** — `@warlock.js/*` has its own tests. Don't re-test that `response.success()` returns 200.
- **Trivial getters / setters** — `cart.totalCents` returning `this.get<number>("totalCents", 0)` doesn't need a test
- **One-line passthroughs** — `loginService(...)` just calling `authService.login(...)` doesn't need a unit test (an integration test of the wiring is better)
- **Generated code** — migrations, resource scaffolds

### 2.3 The rule of thumb

If a future change to this function could silently break behaviour someone cares about, write a test. If a future change would either be obviously broken or obviously fine, skip it.

---

## 3. Test isolation — non-negotiable

### 3.1 No shared mutable state

Each test sets up and tears down its own world. No `let users = []` at the top of the file mutated across tests.

### 3.2 Test order independence

`vitest --shuffle` should still pass. If it doesn't, you have shared state somewhere — fix it before adding more tests.

### 3.3 Database tests

Use transactions that roll back, or use testcontainers with a fresh container per file. Never share rows across tests.

Provide the database fixture in global setup; the framework does not create testcontainers automatically. Give each worker its own database/schema before resetting rows.

### 3.4 Time and randomness

Stub `Date.now()` / `Math.random()` / UUID generation when the test depends on the value. `vi.useFakeTimers()` and `vi.spyOn()` are your tools.

---

## 4. Mocking philosophy

### 4.1 Mock at the boundary

Mock the HTTP client, not the internal functions that use it. Mock the AI provider, not the service that calls it. The further from the boundary you mock, the more your tests describe implementation rather than behaviour.

### 4.2 AI calls — `MockSDK`

Never hit a real provider in tests. Use `MockSDK` from `@warlock.js/ai`:

```typescript
// ✅
import { MockSDK } from "@warlock.js/ai";

const ai = MockSDK({
  responses: [{ text: "mocked response" }],
});

const result = await summarizeContentService(input, { provider: ai });
expect(result).toBe("mocked response");
```

See the `@warlock.js/ai` skill's `run-ai-agent` topic for the full mock surface.

### 4.3 Database — real, via testcontainers

For integration tests, run a real Mongo or Postgres container via `@testcontainers/mongodb` or `@testcontainers/postgresql`. The cost (a few seconds at suite start) is worth the fidelity (catching real-world query issues, real index usage, real type coercion).

For pure-unit tests of services, mock the repository — the service's logic is the unit under test, not the DB.

### 4.4 Time — stub, don't sleep

```typescript
// ❌
await sleep(1000);

// ✅
vi.useFakeTimers();
vi.advanceTimersByTime(1000);
```

A test that sleeps is a test that's slow and flaky. Stub the clock.

Code that reads time through `clock.now()` / `clock.timestamp()` from `@warlock.js/core` gets a frozen clock in tests already (`clockFake.travel(ms)` moves it), with no fake timers involved.

### 4.5 Mail, queue, cache, storage — fakes are already on

In the test environment `setupTest()` installs fakes for mail, queue, cache, storage, clock and ids. Assert on them instead of mocking the drivers:

```typescript
import { mailFake, queueFake } from "@warlock.js/core/tests";

const order = { id: "550e8400-e29b-41d4-a716-446655440000" }; // what the code under test placed

mailFake.assertSent({ to: "ada@example.test" });
queueFake.assertPushed("invoices.send", { orderId: order.id });
```

Fixtures come from `defineFactory()` (deterministic, no faker). Opt out of a fake in `src/config/tests.ts` (`fakes: { cache: false }`). `warlock test --changed` runs only the tests a change affects. See the `test-fakes` and `model-factories` skills of `@warlock.js/core`.

---

## 5. AAA structure

Every test has three phases, separated by blank lines:

```typescript
it("denies cart updates after checkout", async () => {
  // Arrange
  const cart = await cartFactory.create({ status: CartStatus.CHECKED_OUT });
  const update = { totalCents: 99999 };

  // Act
  const promise = updateCartService(cart.id, update, mockUser);

  // Assert
  await expect(promise).rejects.toThrow(CartLockedError);
});
```

### 5.1 One assertion target per test

Multiple `expect` calls are fine if they all verify one outcome. A test that asserts five unrelated things hides which one broke.

### 5.2 Descriptive `it(...)` names

The name describes the expected behaviour, not the implementation. "rejects cart updates after checkout" beats "throws CartLockedError when status is CHECKED_OUT" (the implementation detail is irrelevant to the reader scanning the suite).

---

## 6. Coverage policy

### 6.1 Coverage is a smoke detector

Low coverage = guaranteed gaps. High coverage = no guarantee of correctness. Treat it as a "definitely look here" signal, not a quality metric.

### 6.2 Suggested floors

- `src/app/**/services/**` — ≥ 70% line coverage
- `src/app/**/utils/**` — ≥ 80% (pure code, easy to test)
- `src/app/**/resources/**` — no floor (output-only, low risk)
- `src/app/**/models/**` — no floor (mostly getters; framework tests cover the rest)
- `src/app/**/types/**` — no floor (no runtime behaviour)

### 6.3 Aim for "the meaningful paths are tested", not 100%

Chasing the last 5% of coverage produces brittle tests over edge-case code that nobody cares about. Spend the time on tests that catch real regressions.

### 6.4 The `npm run test:coverage` command

Runs Vitest with `@vitest/coverage-v8` (already in dependencies). Add coverage as a CI gate per the floors above once the suite is large enough.

---

## 7. Flaky test policy — zero tolerance

A test that fails intermittently is a bug, not a nuisance.

### 7.1 The deadline

- **24 hours** to quarantine (mark `.skip` with a tracking ticket).
- **7 days** to fix or delete.

### 7.2 Why the deadline matters

Once a team accepts flakes, the suite dies. Every flake makes the next failure easier to dismiss ("probably flaky"). The signal-to-noise ratio collapses, real failures get ignored, the suite stops being trusted, the team stops writing tests.

Guard against this actively — flake reports are first-priority bugs.

### 7.3 Common causes

- Shared state between tests (see § 3)
- Real I/O without proper teardown
- Timing assumptions (`setTimeout`, polling)
- Test order dependency
- Race conditions in the code under test (test exposed a real bug — fix the code)

---

## 8. Snapshot tests

### 8.1 Use for

- Small structured output that's deterministic
- Error response shapes
- Resource serialization output (small ones)

### 8.2 Don't use for

- Large objects (the diff becomes unreadable; reviewers rubber-stamp)
- Non-deterministic output (timestamps, generated ids — stub them first or omit)
- HTML / large strings (use targeted string assertions instead)

### 8.3 Update with care

`vitest -u` regenerates snapshots. **Read every line of the diff before committing the update.** A blind `-u` is how silent regressions land.

---

## 9. Contract tests

### 9.1 What and why

For any external integration whose shape might drift (third-party API, partner webhook):

- **Provider contract** — what we send, what we expect back
- **Consumer contract** — what they send us, what we expect to handle

Run against a recorded fixture in CI (fast, deterministic). Run against the real endpoint in a nightly job — if their API drifts, you catch it within 24h instead of in production.

### 9.2 Where they live

Co-located with the integration: `src/app/payments/clients/stripe-client.contract.spec.ts`.

---

## 10. File layout

```
src/app/orders/services/
  place-order.service.ts
  place-order.service.spec.ts       ← unit test, mocks repository
  place-order.service.test.ts  ← integration, real DB
```

- `.spec.ts` — default suffix; covers unit tests
- `.test.ts` or a spec inside `tests/` — integration, real I/O (DB, queue)
- Full-system journeys also use `.test.ts` in the integration project.

Tests live next to the file under test, always. Never in a separate `__tests__/` or `test/` folder — colocation makes the link obvious and survives refactors.

---

## 11. Review checklist

Before merging a change that should include tests (testing enabled — see § 0):

- [ ] Every new/changed **service** has a co-located `.service.spec.ts`
- [ ] Every new/changed **HTTP controller / request handler** has a test (unit with mocked services, or integration through the route)
- [ ] New public function has at least one test
- [ ] Branches / error paths / edge cases covered
- [ ] No real provider API hit in tests (use `MockSDK` for AI, mock HTTP clients otherwise)
- [ ] Integration tests use testcontainers, not mocked DBs
- [ ] AAA structure, blank-line phase separation
- [ ] One assertion target per test (where practical)
- [ ] No `await sleep(...)` — fake timers instead
- [ ] No shared mutable state between tests
- [ ] Test names describe behaviour, not implementation
- [ ] No `.only`, no `.skip` without a tracking ticket
- [ ] Snapshots reviewed line-by-line if updated
- [ ] `npm run test --run` passes; `npm run test:coverage` doesn't drop the floor

## Runtime cost and release gates

With `--features=test`, create-warlock delegates to `warlock add test` to generate
`vite.config.ts`: the `unit` project runs `src/**/*.spec.ts` outside `tests/`
without framework or HTTP setup; `integration` runs `*.test.ts` and specs under
`tests/` with `src/test-setup.ts`, global HTTP setup and `src/test-runner.ts`.
Prefer `npx vitest run --project unit` during the pure service loop.

When a unit needs config values, call
`setupTest({ mode: "unit", importModule: (file) => import(file) })` from
`@warlock.js/core/tests` and pair it with `afterAll(teardownTest)`. Config loads
once per module graph, without hooks, connectors, native loader or fakes.
Most unit specs need no setup call.

Integration setup boots the framework once per Vitest worker (`tests.lifetime:
"worker"`): the generated `src/config/tests.ts` also turns on `resetDatabase` (truncates
every table or collection before each file, keeping the migrations ledger), the
integration project has `pool: "forks", isolate: false` with the generated runner, and
`src/config/database.ts` gives each worker its own database
(`<DB_NAME>_test_<worker id>`). Use `vitest run`; watch, threads and isolated graphs are
refused. Keep `afterAll(teardownTest)`: it marks file boundaries while the runner closes
connectors at worker exit. `WARLOCK_TEST_LIFETIME=file` boots once per file instead
(slower, with isolated module state).

Before each file the runtime closes `createTestHttpServer()` servers the previous file
left open, clears the request context, restores the route table to the booted app's,
flushes a real in-memory cache, reinstalls the fakes (mail, queue, cache, storage, fake
clock, ids) and truncates the database. A spec that changes global configuration these
resets do not undo opts its file out with
`setupTest({ importModule: (file) => import(file), lifetime: "file" })`.

The `unit` project fails a spec that imports a connector, `connectorsManager`,
`bootstrap`, a test-server helper, or calls `setupTest()` without `{ mode: "unit" }`.
`warlock check` reports `WL9024` (a warning) for an integration spec that imports nothing
needing the app: rename it to `*.spec.ts`.

Vitest 5 defaults `clearMocks` to true, which also clears the calls a module made when it
was imported (a scheduler registering jobs from `main.ts`). To assert those calls, import
the module inside the test after the mocks are set up, or set `clearMocks: false`.
Set `tests.resetBetweenFiles` to an async application-owned cleanup callback;
it runs before every file, including the first, after selected fakes, clock and
IDs reset. Each worker needs a separate database/schema. Module singletons and
mocks survive; reset application state and restore mocks explicitly. Worker
storage is private and does not mirror the shared HTTP server's fake files.

Use `tests.profileSetup: true` or
`WARLOCK_TEST_PROFILE=1 npx vitest run --project integration` for file timings and
summaries per worker; the run summary lists the boot phases (config, translations,
connectors one by one, fakes, routes, reset, teardown), the HTTP test server's boot and
the slowest files, and `WARLOCK_TEST_PROFILE_JSON=profile.json` writes them as JSON. Pass `file: expect.getState().testPath` in the setup call.
`getTestRuntimeStats()` exposes bootstrap and file counts. Generated configs use
`recommendedTestWorkers()` from `@warlock.js/core/vite` to respect visible cgroup
v2 CPU quotas; reduce `maxWorkers` further for database or memory contention.

Release gate:

```bash
npx warlock test --changed --since "$LAST_RELEASE_REF"
npx vitest run --project integration
# Nightly:
npx vitest run
```
