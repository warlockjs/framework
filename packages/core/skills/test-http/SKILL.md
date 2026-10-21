---
name: test-http
description: 'Integration tests against a real HTTP server — `startHttpTestServer()` boots one shared server in globalSetup, then `testGet` / `testPost` / `expectJson` make typed requests against it. Triggers: `startHttpTestServer`, `startHttpTestServer({ port })`, `startHttpTestServer({ port: 0 })`, `stopHttpTestServer`, `createTestHttpServer`, `TestHttpServer`, `createTestRequestClient`, `snapshotResponse`, `actingAs`, `AuthenticatedTestClient`, `testGet`, `testPost`, `testPut`, `testPatch`, `testDelete`, `expectJson`, `getTestServerUrl`, `testRequest`, `PortInUseError`, `assertPortIsAvailable`, `isPortAvailable`; "integration-test a controller", "end-to-end HTTP test", "globalSetup HTTP server", "assert status and body shape", "test server port already in use", "EADDRINUSE while running tests", "run tests while the dev server is up", "ephemeral test port", "test with the real Fastify plugins", "assert mail sent by a request", "response snapshot"; typical import `import { testGet, testPost, expectJson } from "@warlock.js/core/tests"`. Skip: pure unit tests — the `test-service` topic; controller shape — the `create-controller` topic; competing libs `supertest`, `light-my-request`, `nock`.'
---

# Warlock — HTTP integration tests

Some tests need the full stack: route matching, middleware chain, validation, controller, response serialization. For those, you boot the real HTTP server once per test run and make real `fetch` calls against it.

`startHttpTestServer()` is the bootstrap. `testGet` / `testPost` / `expectJson` are the call helpers. Both ship in `@warlock.js/core/tests`.

⚠ **Changed in 4.13.0 — the import is a subpath now.** These helpers used to be re-exported from the package root; they are not any more, because that put the test helpers into every application's production module graph. `import { testGet } from "@warlock.js/core"` now fails with _"has no exported member"_ — **add `/tests` to the specifier and nothing else changes.**

## The shape

```ts title="src/app/users/tests/users.controller.test.ts"
import { describe, expect, it } from "vitest";
import { expectJson, testGet, testPost } from "@warlock.js/core/tests";

describe("Users API", () => {
  it("GET /users returns the list", async () => {
    const response = await testGet("/users");
    const body = await expectJson<{ users: unknown[] }>(response);
    expect(Array.isArray(body.users)).toBe(true);
  });

  it("POST /users creates a user", async () => {
    const response = await testPost("/users", {
      email: "new@example.com",
      password: "secret",
    });

    const body = await expectJson<{ user: { email: string } }>(response, 201);
    expect(body.user.email).toBe("new@example.com");
  });
});
```

No `beforeAll`, no manual server start — the project's `src/test-global-setup.ts` brought the HTTP server up once before any test ran.

## Signed-in requests — `actingAs(user)`

```ts
import type { Auth } from "@warlock.js/auth";
import { actingAs, expectJson } from "@warlock.js/core/tests";
import { expect } from "vitest";

export async function expectNoUnreadNotifications(user: Auth) {
  const client = await actingAs(user);
  try {
    const body = await expectJson<{ count: number }>(
      await client.get("/notifications/unread-count"),
    );
    expect(body.count).toBe(0);
  } finally {
    await client.dispose();
  }
}
```

`actingAs()` requires `NODE_ENV="test"` before issuing any credentials.
Cookie-only auth middleware needs the app's login route rather than this Bearer client.

The helper calls the user's real `generateAccessToken()` and sends its persisted
credential as a Bearer header. Auth middleware, account policy and token expiry
still apply. It does not test the app's login route or create a user for you.
Use your login route directly when testing credentials/session cookies.

Each client owns its identity, so parallel users and anonymous `testGet()` calls
remain separate. Extra headers/signals use the normal helper options; a supplied
Authorization header is replaced by the bound user's token. `client.dispose()`
revokes only that token. Fixture owners clean up their own users and rows.

## Generated notification specs

Install test support before notifications (`warlock add test`, then
`warlock add notifications`) to emit a shared fixture and signed-in `.spec.ts`
cases for list/unread-count/mark-read/mark-all. They use the configured
`auth.userType.user` model with `actingAs()` and a second recipient to check
isolation. Run against a migrated test database; customize required user fields
in `notifications/tests/notifications.fixture.ts`. Cleanup revokes the fixture's
tokens and deletes only its rows/users.

Existing Vitest configurations must include both test extensions:
`include: ["src/app/**/*.{test,spec}.ts"]`.

## The bootstrap — `startHttpTestServer` / `stopHttpTestServer`

```ts
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core/tests";
```

`startHttpTestServer()` boots a **minimal but real** HTTP server:

- Sets `runtimeStrategy: "development"` and `environment: "test"`.
- Loads `warlock.config.ts` + bootstrap + `filesOrchestrator` (without file watching).
- Loads `src/config/*.ts`.
- Loads every module (`routes.ts`, `main.ts`, `events/*.ts`).
- Starts **ALL** connectors, including HTTP, by default.

Unlike the dev server, it doesn't watch files, doesn't do HMR, doesn't run health checkers. Just a working HTTP endpoint listening on the configured port.

`stopHttpTestServer()` shuts it down — clean tear-down on test-run completion.

Both are idempotent. A second `start` returns early; `stop` on a non-running server logs and returns.

### Choosing the port — `startHttpTestServer({ port })`

```ts
await startHttpTestServer({ port: 3999 });
```

The explicit port wins over `http.port` — including over `HTTP_PORT` in `.env`. Use it to run a suite while the dev server holds the configured port, or to run two suites side by side.

**Nothing else can move the server.** `startHttpTestServer()` bootstraps the app itself, and that bootstrap re-reads `.env` (dotenv overrides by default), so any value you set before calling it is gone before the port is read. Assigning `process.env.HTTP_PORT` does not work either: `env()` reads dotenv's own store and never falls back to `process.env`. The option is applied after the bootstrap, immediately before the connector binds — that is why it is the only channel that survives.

The request helpers follow with no extra wiring: the bound port is published as `WARLOCK_TEST_SERVER_PORT`, which the workers inherit, and `getTestServerUrl()` prefers it over their own `.env`-resolved `http.port`. `stopHttpTestServer()` withdraws it.

### API-only suites — `startHttpTestServer({ web: false })`

```ts
await startHttpTestServer({ web: false });
```

Use this in `globalSetup` for a suite that exercises API routes only. It still boots the HTTP connector and every other configured connector, but excludes the optional `web` connector before its lifecycle begins. That means web's lazy delegate never constructs `WebConnector`, and Vite is never created. Omitting `web` keeps the default full-stack behavior.

### The port is preflighted

Before binding, the test server checks the resolved port is free and fails with an instruction if it isn't:

```
Port 2031 is already in use on localhost. Stop the dev server (or whatever else is
listening on port 2031) and run again, or start on a free port — e.g.
startHttpTestServer({ port: 2032 }).
```

This runs whether or not you passed a port, so a collision never reaches you as a bare `EADDRINUSE` from inside Fastify. The failure is a `PortInUseError` carrying `port` and `host`. The same check is available on its own — `assertPortIsAvailable(port, host)` throws it, `isPortAvailable(port, host)` returns a boolean.

### Port `0` — let the OS pick

```ts
await startHttpTestServer({ port: 0 });
```

`port: 0` binds whatever free port the OS hands out — what `warlock add test` generates. There is nothing to preflight; once the HTTP connector has bound, the port it actually took is published as `WARLOCK_TEST_SERVER_PORT`, so `testGet()`, `actingAs()` and friends follow it. If the connector bound nothing (no `src/config/http.ts`, or a worker-only role), startup fails saying so instead of publishing `0`. A negative port is refused.

⚠ **Changed in 5.31.0.** `port: 0` used to be refused, because the bound port was not recorded anywhere the workers could read. `HttpConnector.start()` now records the port `listen()` returned, and that is what gets published.

### If startup fails, nothing is left behind

`startHttpTestServer()` owns the connectors it starts. A failure part-way through — a bad config, a connector that won't boot — tears down whatever came up, withdraws the published port, and **rethrows the original error**; a failure during that cleanup is logged but never replaces the cause. `stopHttpTestServer()` withdraws the port and resets its state even when the shutdown itself throws, and still surfaces that failure.

## In the worker, with the production plugins — `createTestHttpServer()`

The shared server runs in Vitest's main process, so the test fakes in a worker never see what a request did there. `createTestHttpServer()` serves requests inside the worker instead, built the way production builds it: `startHttpServer()`, every plugin `registerHttpPlugins()` registers (rate limit with its cache store, CORS, multipart, cookies), the router's real route registration, an OS-assigned port.

```ts
import { createTestHttpServer, mailFake, type TestHttpServer } from "@warlock.js/core/tests";
import { afterEach, expect, it } from "vitest";

let app: TestHttpServer | undefined;

afterEach(async () => {
  await app?.close();
});

it("answers through the real plugins and lets the fakes see the handler", async () => {
  app = await createTestHttpServer({
    routes: (router) =>
      router.post("/echo", ({ request, response }) =>
        response.success({ name: request.input("name") }),
      ),
  });

  const response = await app.post("/echo", { name: "Ada" });

  expect(response.status).toBe(200);
  mailFake.assertNothingSent();
});
```

- `loadAppModules: true` (with `importModule: (file) => import(file)`, as `setupTest()` takes it) serves every app route; modules load once per process. Needs `setupTest()` to have run in the worker.
- `routes: (router) => …` registers routes for this server only; `close()` removes them.
- It returns `url`, `port`, `server` (Fastify, for `inject()`), the request helpers, `actingAs(user)` bound to it, and `close()`.
- `createTestRequestClient(baseUrl)` gives the same helpers bound to any URL.

## Response snapshots — `snapshotResponse()`

```ts
import { snapshotResponse, testPost } from "@warlock.js/core/tests";
import { expect, it } from "vitest";

it("creates a post", async () => {
  const response = await testPost("/posts", { title: "Hello" });

  expect(
    await snapshotResponse(response, { redact: ["post.id", "post.createdAt"] }),
  ).toMatchSnapshot();
});
```

The snapshot is `{ status, contentType, body }`; redacted paths read `"[redacted]"`, and `*` matches any key or index (`"posts.*.id"`). It consumes the body.

## Fakes in the server process

`startHttpTestServer()` installs the test fakes too (mail, queue, cache, storage, clock, ids — see the `test-fakes` topic), honouring `tests.fakes` and its own `fakes` option. They record in the main process, so assert on request side effects with `createTestHttpServer()`; the storage fake's temp root is shared with the workers (`WARLOCK_TEST_STORAGE_ROOT`).

## Project wiring — `src/test-global-setup.ts` + `vite.config.ts`

```ts title="src/test-global-setup.ts"
/**
 * Global Test Setup
 * Runs ONCE in the main process before all test workers start.
 */
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core/tests";

export async function setup() {
  await startHttpTestServer({ port: 0 });
}

export async function teardown() {
  await stopHttpTestServer();
}
```

```ts title="vite.config.ts"
import { lowerStage3Decorators } from "@warlock.js/core/vite";
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [lowerStage3Decorators(), mongezVite()],
  test: {
    globalSetup: "./src/test-global-setup.ts", // ← starts the HTTP server
    setupFiles: ["./src/test-setup.ts"], // ← setupTest + afterAll(teardownTest), per test file
    environment: "node",
    globals: false,
    include: ["src/app/**/*.{test,spec}.ts"],
  },
});
```

Both files (and this config, with `lowerStage3Decorators()` first so decorated models load) are created by `warlock add test`. The split is intentional: `globalSetup` runs **ONCE** in the main vitest process; `setupFiles` runs **before every test file**.

⚠ **Corrected in 4.14.0.** This line previously said `setupFiles` runs "per worker thread". **It does not** — Vitest runs it before each test file, and the setup module's registry is rebuilt every time. Measured across all four `pool` × `isolate` combinations.

**So the service-layer framework is file-scoped: bootstrapped by `setupTest` and closed by the `afterAll(teardownTest)` the setup file registers, once per test file.** ⚠ **`setupTest` alone is not the whole wiring — the paired teardown is mandatory from 4.14.0**; see the `test-service` skill.

**HTTP is the exception and stays in `globalSetup`**, which genuinely does run once in the main vitest process and owns a real port. **That split is the point:** one server for the whole run, one framework per test file.

### Keep Vitest setup out of development

`warlock dev` (and `warlock build`) load your app's `vite.config.ts`. Anything you put there for tests runs in development too. Guard vitest-only setup:

```ts
// vite.config.ts
if (process.env.VITEST) {
  Object.assign(process.env, testEnv); // test database, test keys...
}
```

## HTTP request helpers

Everything is built on native `fetch` — no extra dependency, no special wire format.

### URL resolution

```ts
import { getTestServerUrl } from "@warlock.js/core/tests";

const url = getTestServerUrl(); // → "http://localhost:2031" (defaults)
```

Reads `http.host` (default `"localhost"`) and `http.port` (default `2031`) from config — unless `startHttpTestServer` published a port, which wins, since a worker's own config never sees the `{ port }` option passed in `globalSetup`. If you change the HTTP config, helpers follow automatically.

### Verb helpers

```ts
import {
  testRequest,
  testGet,
  testPost,
  testPut,
  testPatch,
  testDelete,
} from "@warlock.js/core/tests";

await testGet("/products");
await testGet("/products?published=true", { headers: { "X-Tenant": "abc" } });
await testPost("/products", { name: "Pen", price: 5 });
await testPut("/products/42", { name: "Updated" });
await testPatch("/products/42", { price: 10 });
await testDelete("/products/42");
```

All accept a relative path (leading `/` optional) and a standard `RequestInit`. The body, if passed, is JSON-stringified automatically; the `Content-Type: application/json` header is set unless you override.

`testRequest(path, options)` is the underlying primitive — use it when you need a method the helpers don't cover (e.g., `OPTIONS`).

### Parsing + asserting — `expectJson<T>`

```ts
import { expectJson, parseJsonResponse } from "@warlock.js/core/tests";

type MyShape = { id: number; name: string };
declare const response: Response; // from testGet / testPost / fetch

// Parse-only
const parsed = await parseJsonResponse<MyShape>(response);

// Assert status + parse in one call
const ok = await expectJson<MyShape>(response); // expects 200
const created = await expectJson<MyShape>(response, 201); // expects 201
const missing = await expectJson<MyShape>(response, 404); // expects 404 (testing error paths)
```

`expectJson` throws with the actual status + response body when the assertion fails — no chasing "got 500" messages without context.

## Patterns

### Happy path — create + read

```ts
import { describe, expect, it } from "vitest";
import { expectJson, testGet, testPost } from "@warlock.js/core/tests";

describe("Products API — happy path", () => {
  it("creates and reads back a product", async () => {
    const create = await testPost("/products", {
      name: "Test Product",
      price: 99,
    });
    const { product } = await expectJson<{ product: { id: string } }>(create, 201);

    const read = await testGet(`/products/${product.id}`);
    const { product: fetched } = await expectJson<{
      product: { name: string; price: number };
    }>(read);

    expect(fetched.name).toBe("Test Product");
    expect(fetched.price).toBe(99);
  });
});
```

### Validation errors

```ts
it("rejects missing required fields with 400", async () => {
  const response = await testPost("/products", { name: "" }); // price missing
  const body = await expectJson<{ errors: Array<{ key: string }> }>(response, 400);

  expect(body.errors.some((e) => e.key === "price")).toBe(true);
});
```

The HTTP server runs the real validation middleware — 400-with-error-list is the production code path.

### Authenticated routes — JWT bearer

```ts
import { authService } from "@warlock.js/auth";
import { User } from "src/app/users/models/user";

it("GET /me returns the current user", async () => {
  const user = await User.create({ email: "auth@e.com", password: "secret" });
  const { accessToken } = await authService.createTokenPair(user);

  const response = await testGet("/me", {
    headers: { Authorization: `Bearer ${accessToken.token}` },
  });

  const { user: me } = await expectJson<{ user: { email: string } }>(response);
  expect(me.email).toBe("auth@e.com");
});
```

Use the auth service's token generator instead of hand-crafting JWTs — keeps tests aligned with production token shape and signature.

### Building an auth helper

When most of your tests need a token, hoist the boilerplate:

```ts title="src/test-utils/auth-test-helpers.ts"
import { authService } from "@warlock.js/auth";
import { User } from "src/app/users/models/user";

export async function createUserAndToken(overrides: Partial<{ email: string }> = {}) {
  const user = await User.create({
    email: overrides.email ?? `user-${Date.now()}@e.com`,
    password: "test-secret",
  });

  const { accessToken } = await authService.createTokenPair(user);
  return { user, accessToken, authHeader: { Authorization: `Bearer ${accessToken.token}` } };
}
```

Then in tests:

```ts
const { authHeader } = await createUserAndToken();
const response = await testGet("/me", { headers: authHeader });
```

### Setting up data via direct DB access

The HTTP server runs in the main process; the test workers have their own DB connections. To seed data the HTTP server can read, either:

1. **Direct create from the test** — your worker writes via the model, the row commits, then the HTTP server reads it (both point at the same physical DB).

   ```ts
   await Product.create({ name: "Seed product", price: 10 });
   const response = await testGet("/products");
   ```

2. **Create over HTTP** — the request goes through the controller, so the HTTP server's connection is the one writing.

Approach #1 is faster and gives you more control over the initial state. Approach #2 is more end-to-end.

## Two-worlds: workers vs HTTP server

```
┌──────────────────────────┐       ┌──────────────────────────┐
│  Vitest worker thread    │       │  Main process            │
│  (one per test file)     │       │  (vitest globalSetup)    │
│                          │       │                          │
│  setupTest() →           │       │  startHttpTestServer() → │
│   db connection A        │       │   db connection B        │
│   models, services       │       │   HTTP server :2031      │
│                          │       │                          │
│   testGet("/products") ───── HTTP ──→ controller → response │
│                          │       │                          │
└──────────────────────────┘       └──────────────────────────┘
```

- Worker writes a row via `Product.create(...)` → uses **connection A**.
- HTTP server reads via the controller → uses **connection B**.
- Both connections point at the same physical DB, so as long as the worker write has committed, the HTTP server sees it on the next read.

This is fine for normal test flow. It bites when you're inside a transaction the worker hasn't committed — the HTTP server's connection won't see uncommitted data. Don't wrap test fixtures in long-lived transactions for that reason.

## Gotchas

- **`globalSetup` must export `setup` and `teardown`.** Vitest reads them by name. A typo in the export gets you a confusing "server not running" error on the first `testGet` call.
- **Port conflicts.** If `http.port` matches your running dev server, the preflight fails with a `PortInUseError` naming the port. Pass `startHttpTestServer({ port: 0 })` to let the OS pick, or a fixed free one: `startHttpTestServer({ port: 3999 })`.
- **Auth tokens need a real user.** Generating a JWT with a non-existent `user_id` works — but the auth middleware's user-loading step will reject the request with 401 because it can't find the user in the DB.
- **`expectJson` parses the body once.** If you call it twice on the same response, the second call gets an already-consumed stream error. Capture the result.
- **The HTTP server's connection is NOT torn down between test files.** Data persists across files within a single `vitest` run. Either truncate in `afterEach` / `afterAll`, or design your tests to be order-independent.
- **No HMR / file watching.** Editing a controller during a watch run does NOT reload the HTTP server — restart `vitest --watch` to pick up controller changes. The dev server is the place for live reloading; the test server is intentionally minimal.

## See also

- The `test-service` topic — pure unit tests against services/repositories/models (no HTTP).
- The `test-fakes` topic — mail, queue, cache, storage, clock and ids fakes and their assertions.
- The `model-factories` topic — `defineFactory()` for deterministic fixtures.
- The `make-endpoint` topic — `warlock make endpoint` writes an endpoint with its HTTP test.
- The `create-controller` topic — the controller shape your HTTP tests are exercising.
- The `warlock-conventions` topic — module layout, where `tests/*.test.ts` files live.
- The `write-cli-command` topic — `warlock add test` scaffolds both global + worker setup files.

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

## Response contracts from declared schemas

`assertResponseContracts` from `@warlock.js/core/tests` sends HTTP requests and
asserts the serialized JSON body against the handler's `responseSchema` for the
actual status. It reuses Core's OpenAPI schema translation, including resource
classes, nested objects, arrays, nullable casts and resource self references.
It checks required fields and primitive types without coercion; extra fields
are allowed. URL/date format annotations are not checked beyond their declared
JSON shape. Builders, computed resolvers and resources without a static shape
fail with a diagnostic rather than silently passing.

```ts
import { it } from "vitest";
import { router } from "@warlock.js/core";
import { assertResponseContracts } from "@warlock.js/core/tests";

it("matches product response declarations", async () => {
  await assertResponseContracts({
    routes: router.list().filter((route) => route.path === "/products"),
    cases: () => [{ path: "/products?page=1&limit=10", status: 200 }],
    requireAllStatuses: true,
  });
});
```

With the shared test server, retain `startHttpTestServer({ port: 0 })` in global
setup and `setupTest` in the worker. The routes and their handler schemas must
also be loaded in the worker running this assertion (import their routes module
there); global setup runs in a different process. Omit `routes` to discover all
registered routes with `responseSchema` in that worker. Empty discovery fails.
Explicit routes lacking a schema also fail.

Static GET routes default to one request without headers. Parameterized routes
and non-GET methods require explicit `cases(route)` fixtures; an empty case
list fails. Each case can supply a concrete `path`, `init` (headers, serialized
body, etc.) and expected `status`. Supply fixtures with valid IDs, seeded data,
authentication and invalid inputs to exercise the desired outcomes. An `all` route also needs a concrete fixture `method`. Redirects
are not followed. POST/PUT/PATCH/DELETE fixtures execute real side effects;
use isolated test data and clean it up.

Undeclared response statuses fail. Only statuses actually returned are checked
by default; `requireAllStatuses: true` additionally fails if any declared status
has no exercised fixture. HEAD, 204 and 304 responses must have an empty body; declare it with
`{ body: {} }`. Other statuses must carry matching JSON.

For an in-process server, pass `client: app` from `createTestHttpServer()` and
close it in teardown. For signed-in requests, pass `client: await actingAs(user)`
and dispose that client afterward. These clients use the same assertion and
run the real HTTP middleware and serialization paths.
