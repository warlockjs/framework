---
title: "Testing"
description: How Warlock tests work — the two-worlds model (per-worker bootstrap + one global HTTP server), `setupTest` for unit tests, `startHttpTestServer` for integration tests, fakes that are on by default, model factories, an in-process server with the production plugins, and `warlock test --changed`.
sidebar:
  order: 1
  label: "Testing"
---

Warlock tests run on Vitest, and the framework ships a small layer on top that gives you two distinct testing modes: **unit tests** that call services / repositories / models directly, and **integration tests** that hit a real HTTP server over fetch. Each mode has its own bootstrap.

This guide explains the architecture, then walks both modes end-to-end.

## The 30-second look

```bash
# One command from a fresh project — drops vite.config.ts, test-global-setup.ts, test-setup.ts
pnpm warlock add test

# Run the suite
pnpm test

# Watch mode while you work
pnpm test:watch
```

A unit test looks like this:

```ts title="src/app/products/tests/create-product.service.test.ts"
import { describe, expect, it } from "vitest";
import { createProductService } from "../services/create-product.service";

describe("createProductService", () => {
  it("creates a product with a slug", async () => {
    const product = await createProductService({ name: "Pen", price: 5 });
    expect(product.get("slug")).toBe("pen");
  });
});
```

An HTTP integration test looks like this:

```ts title="src/app/products/tests/products.controller.test.ts"
import { describe, expect, it } from "vitest";
import { expectJson, testPost } from "@warlock.js/core";

describe("POST /products", () => {
  it("creates a product over HTTP", async () => {
    const response = await testPost("/products", { name: "Pen", price: 5 });
    const { product } = await expectJson<{ product: { id: string } }>(response, 201);
    expect(product.id).toBeDefined();
  });
});
```

Both run against your real code. No mocks of the framework, no in-memory replacements for the DB. The bootstraps below explain how that works without each test paying a multi-second setup cost.

## Keep Vitest setup out of development

`warlock dev` (and `warlock build`) load your app's `vite.config.ts`. Anything you put there for tests runs in development too. Guard vitest-only setup:

```ts title="vite.config.ts"
if (process.env.VITEST) {
  Object.assign(process.env, testEnv); // test database, test keys...
}
```

## The two-worlds architecture

Vitest runs test files in **worker threads** — one worker per file by default, parallelized. The HTTP server needs to live somewhere that all those workers can reach. So the framework splits the bootstrap into two layers:

```
┌─── Main vitest process (one) ────────────────────────────┐
│                                                          │
│   globalSetup: ./src/test-global-setup.ts                │
│     └─ startHttpTestServer()                             │
│         • boots ALL connectors (db, http, socket, …)     │
│         • listens on http://localhost:2031               │
│         • owns its own DB connection                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
            │ HTTP fetch requests
            ▼
┌─── Worker thread N (one per test file) ──────────────────┐
│                                                          │
│   setupFiles: ./src/test-setup.ts                        │
│     └─ setupTest({ connectors: true })                   │
│         • boots Early-phase connectors EXCEPT http        │
│         • owns ITS OWN db / cache connection             │
│         • calls services, repositories, models directly   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

The HTTP server runs once and stays up for the whole `vitest` run. Each worker owns a parallel set of connections so service-level tests don't fight over a shared DB pool.

Two consequences worth pulling out:

- **Per-worker writes go to a different connection than HTTP-server reads.** Both point at the same physical DB, so committed data is mutually visible — but uncommitted transactions are not.
- **The HTTP server is a real server.** Real routing, real middleware, real validation, real responses. You don't need a separate "mode" — production code is the test code.

## Mode 1 — Unit tests

Anything you can import and call without going through HTTP. Services, repositories, models, use-cases, util functions.

### `setupTest({ connectors })`

Each Vitest worker runs `src/test-setup.ts` once before any test in that worker executes. The file calls `setupTest`:

```ts title="src/test-setup.ts"
import { setupTest } from "@warlock.js/core";

await setupTest({ connectors: true });
```

`setupTest` runs the framework's bootstrap (env, config, modules, files orchestrator) and starts the connectors you ask for. It's idempotent per worker — re-calling early-returns.

### The `connectors` knob

| Value                   | Boots                                                               | Use when                                           |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| `true` _(default)_      | All Early-phase connectors **except `http`** (db, cache, logger, …) | Most service / model tests. Sensible default.      |
| `false`                 | Nothing                                                             | Pure logic with no framework subsystem touches.    |
| `["database", "cache"]` | Only those, in that order                                           | A narrow test that needs DB but not, say, storage. |

You can also set `tests.connectors` in `src/config/tests.ts` for a project-wide default that overrides the `setupTest` parameter:

```ts title="src/config/tests.ts"
const testsConfigurations = {
  connectors: ["database", "logger"],
};

export default testsConfigurations;
```

### A complete unit test

```ts title="src/app/orders/tests/place-order.service.test.ts"
import { afterEach, describe, expect, it } from "vitest";
import { Cart } from "../../carts/models/cart";
import { Order } from "../models/order";
import { placeOrderService } from "../services/place-order.service";

describe("placeOrderService", () => {
  afterEach(async () => {
    await Order.query().delete();
    await Cart.query().delete();
  });

  it("creates an order from a cart", async () => {
    const cart = await Cart.create({
      user_id: "u_1",
      items: [{ product_id: "p_1", quantity: 2, unit_price: 50 }],
    });

    const order = await placeOrderService({ cart_id: cart.id });

    expect(order.get("total")).toBe(100);
    expect(order.get("status")).toBe("pending_payment");
  });

  it("throws when the cart is empty", async () => {
    const cart = await Cart.create({ user_id: "u_1", items: [] });

    await expect(placeOrderService({ cart_id: cart.id })).rejects.toThrow(/empty/i);
  });
});
```

No bootstrap in the file — `src/test-setup.ts` already did it. Direct calls to services and models. Real DB. Vitest's `afterEach` resets between tests so the order is deterministic.

For the full unit-test playbook, see `test-service/SKILL.md`.

## Mode 2 — HTTP integration tests

When you want to assert the full stack: route resolution, middleware chain, validation, controller, response shape.

### `startHttpTestServer()` in `globalSetup`

```ts title="src/test-global-setup.ts"
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core";

export async function setup() {
  await startHttpTestServer();
}

export async function teardown() {
  await stopHttpTestServer();
}
```

Vitest calls `setup` before any worker spawns and `teardown` after they all exit. The server boots once, your tests share it.

The server is "real but minimal" — no file watching, no HMR, no health checkers. Same routing and middleware as production.

### The HTTP helpers

```ts
import {
  testGet,
  testPost,
  testPut,
  testPatch,
  testDelete,
  testRequest,
  expectJson,
  parseJsonResponse,
  getTestServerUrl,
} from "@warlock.js/core";
```

Everything is built on native `fetch`:

```ts
const response = await testPost("/products", { name: "Pen", price: 5 });
//   sends JSON body, sets Content-Type, returns the Response

const body = await expectJson<{ product: { id: string } }>(response, 201);
//   asserts status === 201, parses JSON, throws with response body on mismatch

console.log(body.product.id);
```

`getTestServerUrl()` reads `http.host` + `http.port` from config — change those, the helpers follow.

### A complete HTTP test

```ts title="src/app/products/tests/products.controller.test.ts"
import { describe, expect, it } from "vitest";
import { authService } from "@warlock.js/auth";
import { expectJson, testGet, testPost } from "@warlock.js/core";
import { User } from "../../users/models/user";

describe("Products API", () => {
  it("requires auth on POST /products", async () => {
    const response = await testPost("/products", { name: "Pen", price: 5 });
    await expectJson(response, 401);
  });

  it("creates a product when authenticated", async () => {
    const user = await User.create({ email: "u@e.com", password: "secret" });
    const { accessToken } = await authService.createTokenPair(user);

    const response = await testPost(
      "/products",
      { name: "Pen", price: 5 },
      { headers: { Authorization: `Bearer ${accessToken.token}` } },
    );

    const { product } = await expectJson<{
      product: { id: string; name: string };
    }>(response, 201);

    expect(product.name).toBe("Pen");

    // Read it back via HTTP
    const list = await testGet("/products");
    const { products } = await expectJson<{ products: Array<{ id: string }> }>(list);
    expect(products.some((p) => p.id === product.id)).toBe(true);
  });

  it("validates the request body", async () => {
    const response = await testPost("/products", { name: "" });
    const body = await expectJson<{ errors: Array<{ key: string }> }>(response, 400);
    expect(body.errors.some((e) => e.key === "name")).toBe(true);
  });
});
```

For the full HTTP-test playbook, see `test-http/SKILL.md`.

## The test kit

Everything below ships in `@warlock.js/core/tests`, next to `setupTest` and the HTTP helpers.

### Fakes — on by default

In the test environment `setupTest()` (per test file) and `startHttpTestServer()` (in `globalSetup`) install seven fakes once their connectors are up, and restore them on teardown:

| Fake          | Replaces                                                         | Assertions                                                                                                        |
| ------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `mailFake`    | Mail delivery — `sendMail()` / `Mail` capture instead of send    | `assertSent(matcher?)`, `assertNotSent`, `assertSentCount(n, matcher?)`, `assertNothingSent`, `sent()`            |
| `queueFake`   | `@warlock.js/queue` dispatch — recorded, never pushed to Redis   | `assertPushed(job, payload?)`, `assertNotPushed`, `assertPushedCount(n, job?)`, `assertNothingPushed`, `pushed()` |
| `cacheFake`   | The cache's current driver — a fresh in-memory driver            | `assertHas(key)`, `assertMissing(key)`, `assertStored(key, value)`                                                |
| `storageFake` | Every storage driver (local, S3, R2, Spaces) — a temp directory  | `assertExists(path, driver?)`, `assertMissing(path, driver?)`, `files(driver?)`                                   |
| `clockFake`   | `clock` from `@warlock.js/core` — frozen at 2026-01-01T00:00:00Z | `travel(ms)`, `travelTo(date)`, `freeze(date?)`, `now()`                                                          |
| `idsFake`     | `ids` from `@warlock.js/core` — numbered UUIDs and tokens        | `uuid(n)` (the n-th UUID), `reset()`                                                                              |
| `secretsFake` | The `secrets` facade — isolated namespace-aware memory           | `assertHas(name)`, `assertMissing(name)`, `assertStored(name, value)`, `clear()`                                  |

```ts title="src/app/users/tests/register-user.service.test.ts"
import { mailFake, queueFake } from "@warlock.js/core/tests";
import { beforeEach, expect, it } from "vitest";
import { sendWelcomeSeries } from "../jobs/send-welcome-series.job";
import { registerUserService } from "../services/register-user.service";

beforeEach(() => {
  mailFake.clear();
  queueFake.clear();
});

it("welcomes a new user and schedules the follow-up mails", async () => {
  const user = await registerUserService({ name: "Ada", email: "ada@example.test" });

  mailFake.assertSent({ to: "ada@example.test", subject: /welcome/i });
  queueFake.assertPushed(sendWelcomeSeries, { userId: user.id });
});
```

The [secret store](/v/latest/core/digging-deeper/secrets/) fake bypasses keychain, environment and files. It retains values only in its process; assertion failures never reveal them. Opt out with `fakes: { secrets: false }` for deliberate backend integration tests.

A matcher is a predicate or an object of fields that must all match (`{ to, subject, from, contains }` for mail; a payload subset for jobs). A failing assertion lists what was actually recorded.

Jobs are recorded, not run — call the job's handler directly to test what it does. The clock and ids fakes replace only the framework's `clock` and `ids`; `Date`, `setTimeout` and drivers keep real time, so nothing stalls. Read the time through `clock.now()` / `clock.timestamp()` and generate identifiers through `ids.uuid()` / `ids.token()` where a test needs to control them.

**A fake records in the process that runs the code.** Mail sent while the shared HTTP server (Vitest's main process) handles a request is captured there, not in the test worker that sent the request. To assert on what a request did, serve it in the worker with [`createTestHttpServer()`](#in-process-server-with-the-production-plugins). The storage fake is the exception: its temp root is shared with the workers, so a file an HTTP request stored is visible to the test.

#### Opting out

Precedence is the `fakes` option > `tests.fakes` in `src/config/tests.ts` > all on.

```ts title="src/config/tests.ts"
const testsConfigurations = {
  // keep the real drivers for every fake:
  // fakes: false,
  // or only for some:
  fakes: { cache: false, storage: false },
};

export default testsConfigurations;
```

```ts
await setupTest({ importModule: (file) => import(file), fakes: false });
await startHttpTestServer({ port: 0, fakes: { queue: false } });
```

An unknown fake name or a non-boolean value fails setup with the list of known fakes. Tests that relied on real deliveries, a real Redis cache shared between the HTTP server and the workers, or real buckets need `fakes: false` (or the matching per-fake `false`).

### Model factories

`defineFactory(Model, (seed) => attributes)` builds deterministic records — no faker, no randomness. The n-th record a factory builds is the same on every run.

```ts title="src/app/users/tests/user.factory.ts"
import { defineFactory } from "@warlock.js/core/tests";
import { User } from "app/users/models/user";

export const userFactory = defineFactory(User, (seed) => ({
  name: seed.text("User"), // "User 1", "User 2", ...
  email: seed.email(), // "user1@example.test", ...
  password: "test-password",
})).state("admin", () => ({ role: "admin" }));
```

```ts
const body = userFactory.make({ name: "Ada" }); // attributes only, no database
const users = await userFactory.create(3); // three saved users
const admin = await userFactory.with("admin").create();
```

`make()` / `makeMany(n)` return attributes without touching the database — use them for request bodies. `create()` saves through the model's own `create()`, so casts, defaults, hooks and events run; `create(n)` / `createMany(n)` save `n` in order. The seed offers `sequence`, `index`, `text(prefix)`, `email(prefix)`, `uuid()`, `date(offsetDays)`, `number(min, max)` and `pick(values)`. Overrides may be a partial or a function of the seed. `resetFactorySequences()` restarts every factory.

### In-process server with the production plugins

`createTestHttpServer()` starts an HTTP server inside the test worker, built the way production builds it: the same Fastify setup, every plugin production registers (rate limit with its cache store, CORS, multipart, cookies) and the router's real route registration, listening on an OS-assigned port. Tests cannot drift from real request shapes, and the fakes see what the handler did.

```ts
import { createTestHttpServer, mailFake } from "@warlock.js/core/tests";
import { afterAll, beforeAll, expect, it } from "vitest";

let app: Awaited<ReturnType<typeof createTestHttpServer>>;

beforeAll(async () => {
  // every app route; pass the same importer setupTest() takes
  app = await createTestHttpServer({ loadAppModules: true, importModule: (file) => import(file) });
});

afterAll(() => app.close());

it("mails the support inbox", async () => {
  const response = await app.post("/api/contact", {
    name: "Ada",
    email: "ada@example.test",
    message: "Hi",
  });

  expect(response.status).toBe(200);
  mailFake.assertSent({ to: "support@example.test" });
});
```

It returns `url`, `port`, the Fastify `server`, the request helpers (`request`, `get`, `post`, `put`, `patch`, `delete`), `actingAs(user)` bound to it, and `close()`. Pass `routes: (router) => …` instead of (or as well as) `loadAppModules` to register routes for one test; `close()` removes them. App modules load once per process.

### Ephemeral ports

`startHttpTestServer({ port: 0 })` lets the OS pick a free port and publishes the bound one to the workers, so the suite never collides with `warlock dev` or another suite. `warlock add test` generates `src/test-global-setup.ts` with it. `createTestHttpServer()` always uses an OS-assigned port.

### Response snapshots

`snapshotResponse(response, { redact })` reduces a response to `{ status, contentType, body }` with the values that change every run replaced by `"[redacted]"`:

```ts
const response = await testPost("/posts", { title: "Hello" });

expect(
  await snapshotResponse(response, { redact: ["post.id", "post.createdAt"] }),
).toMatchSnapshot();
```

`*` matches any key or array index (`"posts.*.id"`). It consumes the body — call it instead of `response.json()`.

## Picking the right mode

| You're testing                                              | Mode                          |
| ----------------------------------------------------------- | ----------------------------- |
| A service / use-case / repository in isolation              | Unit (`test-service`)         |
| A model's transformers / accessors / hooks                  | Unit                          |
| A util function with no DB                                  | Unit with `connectors: false` |
| A route's auth / validation / response shape                | HTTP (`test-http`)            |
| Multi-controller flow (e.g. order placement → notification) | HTTP                          |
| Error response status codes                                 | HTTP                          |

Default to unit tests — they're faster and easier to reason about. Promote to HTTP when the value of the test is "does the full route work" rather than "does this function work."

## Project layout

`warlock add test` drops three files:

- **`src/test-global-setup.ts`** — vitest `globalSetup`, starts/stops the HTTP server.
- **`src/test-setup.ts`** — vitest `setupFiles`, runs `setupTest` per worker.
- **`vite.config.ts`** — wires both above, sets `include: ["src/app/**/*.test.ts"]`.

It also installs `vitest`, `@vitest/coverage-v8`, `vite`, and `@mongez/vite` (which is what makes TypeScript imports + the framework's module layout work under vitest).

Tests live colocated with the module they exercise:

```
src/app/products/
  models/
  services/
  controllers/
  tests/
    create-product.service.test.ts
    products.controller.test.ts
```

## Running tests

```bash
pnpm test                  # one-shot run
pnpm test:watch            # watch mode
pnpm test:coverage         # with v8 coverage
pnpm test:ui               # vitest UI
```

You can scope down with vitest's filename or test-name filters:

```bash
pnpm test create-product           # files matching "create-product"
pnpm test -t "creates a product"   # test name pattern
```

`warlock test` runs the project's own Vitest and can run only what a change affects — the fast loop while you work:

```bash
warlock test --changed                 # tests affected by uncommitted changes
warlock test --changed --since main    # ... by changes since main
warlock test --related src/app/posts/services/create-post.service.ts
warlock test --json                    # machine-readable results on stdout
```

See [CLI commands](../cli/cli-commands.md#test-filters) for every flag.

## Caveats and trade-offs

When a unit test copies TypeScript source into a temporary directory for a fresh
Node process, preserve the source package's module mode. ESM fixtures need a
`package.json` with `"type": "module"`; otherwise `tsx` can load the copy as
CommonJS and named exports fail before the behavior under test runs. Assert the
child process exit status with its captured stderr before checking stdout.

- **The two-worlds connection split is intentional.** Don't fight it by trying to share connections — it would deadlock test parallelism. Instead, design tests so the worker write commits before the HTTP read.
- **Test data persists across files unless you clean it up.** Vitest doesn't wrap test files in transactions. Use `afterEach` truncates or design idempotent fixtures.
- **The HTTP server is started in dev mode (`runtimeStrategy: development`).** That's so routes get re-resolved properly under the framework's dev orchestrator. It's still a real server with real routing — just not the production builder pipeline.
- **Fakes, not mocks.** Mail, queue, cache, storage, clock, ids and secrets are faked by default ([the test kit](#the-test-kit)); everything else runs for real. For an external API (OpenAI, Stripe), vitest's `vi.mock(...)` works fine.

## See also

- `test-service/SKILL.md` — per-task playbook for unit tests.
- `test-http/SKILL.md` — per-task playbook for HTTP integration tests.
- [Integration test recipe](../recipes/integration-tests.md) — end-to-end walkthrough of testing a CRUD controller.
- [`warlock add` features](../cli/cli-commands.md) — what `warlock add test` installs.

### Verify shared rate limits against Redis

Framework contributors can run the cache-backed rate-limit store checks from `packages/core` with `WARLOCK_REDIS_INTEGRATION=1 npx vitest run src/http/rate-limit-cache-store.redis.spec.ts`. The suite connects to `QUEUE_REDIS_HOST` / `QUEUE_REDIS_PORT` (defaults `127.0.0.1:6390`), uses isolated UUID-prefixed keys, and fails if the requested Redis service is unavailable. It exercises separate Redis clients, concurrent counts, preserved window deadlines, aligned window resets, and a seed that actually expires before its atomic increment. Without the opt-in flag it reports a local skip; CI enables it against its Redis service.

## Worker dictionaries and owned runtime resources

The generated `src/test-setup.ts` calls:

```ts
await setupTest({ importModule: (file) => import(file) });
```

`setupTest()` reads `src/app/*/utils/locales.json` after configuration in each
Vitest worker. Server translation helpers therefore see all configured locales
without manual registration. Invalid dictionaries fail setup. `teardownTest()`
unregisters those dictionaries; legacy executable locale files still require
explicit imports in worker setup.

Global HTTP fixtures should use `await startHttpTestServer({ port: 0, web: false })`
for API-only suites and `await stopHttpTestServer()` in teardown. Stop releases
connectors and the file runtime's loader channel, queued work, watchers, health
workers, and registered module cleanup hooks, including after partial startup.
A Node loader registration is process-scoped; its message channel is closed at
teardown. Module-owned timers/listeners must register their cleanup hooks.

A module that owns a long-running handle can export an awaited cleanup:

```ts
// src/app/messages/main.ts
import { createServer } from "node:net";
const listener = createServer();
listener.listen(0, "127.0.0.1");
export async function cleanup(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
}
```

HTTP test teardown awaits these cleanup functions and reports failures after
attempting every module's cleanup. Avoid leaving module-owned handles running
outside this lifecycle.
