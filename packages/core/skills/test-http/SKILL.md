---
name: test-http
description: 'Integration tests against a real HTTP server — `startHttpTestServer()` boots one shared server in globalSetup, then `testGet` / `testPost` / `expectJson` make typed requests against it. Triggers: `startHttpTestServer`, `stopHttpTestServer`, `testGet`, `testPost`, `testPut`, `testPatch`, `testDelete`, `expectJson`, `getTestServerUrl`, `testRequest`; "integration-test a controller", "end-to-end HTTP test", "globalSetup HTTP server", "assert status and body shape"; typical import `import { testGet, testPost, expectJson } from "@warlock.js/core"`. Skip: pure unit tests — `@warlock.js/core/test-service/SKILL.md`; controller shape — `@warlock.js/core/create-controller/SKILL.md`; competing libs `supertest`, `light-my-request`, `nock`.'
---

# Warlock — HTTP integration tests

Some tests need the full stack: route matching, middleware chain, validation, controller, response serialization. For those, you boot the real HTTP server once per test run and make real `fetch` calls against it.

`startHttpTestServer()` is the bootstrap. `testGet` / `testPost` / `expectJson` are the call helpers. Both ship in `@warlock.js/core`.

## The shape

```ts title="src/app/users/tests/users.controller.test.ts"
import { describe, expect, it } from "vitest";
import { expectJson, testGet, testPost } from "@warlock.js/core";

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

## The bootstrap — `startHttpTestServer` / `stopHttpTestServer`

```ts
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core";
```

`startHttpTestServer()` boots a **minimal but real** HTTP server:

- Sets `runtimeStrategy: "development"` and `environment: "test"`.
- Loads `warlock.config.ts` + bootstrap + `filesOrchestrator` (without file watching).
- Loads `src/config/*.ts`.
- Loads every module (`routes.ts`, `main.ts`, `events/*.ts`).
- Starts **ALL** connectors, including HTTP.

Unlike the dev server, it doesn't watch files, doesn't do HMR, doesn't run health checkers. Just a working HTTP endpoint listening on the configured port.

`stopHttpTestServer()` shuts it down — clean tear-down on test-run completion.

Both are idempotent. A second `start` returns early; `stop` on a non-running server logs and returns.

## Project wiring — `src/test-global-setup.ts` + `vite.config.ts`

```ts title="src/test-global-setup.ts"
/**
 * Global Test Setup
 * Runs ONCE in the main process before all test workers start.
 */
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core";

export async function setup() {
  await startHttpTestServer();
}

export async function teardown() {
  await stopHttpTestServer();
}
```

```ts title="vite.config.ts"
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [mongezVite()],
  test: {
    globalSetup: "./src/test-global-setup.ts",  // ← starts the HTTP server
    setupFiles: ["./src/test-setup.ts"],         // ← per-worker setupTest (see test-service skill)
    environment: "node",
    globals: false,
    include: ["src/app/**/*.test.ts"],
  },
});
```

Both files are created by `warlock add test`. The split is intentional: `globalSetup` runs ONCE in the main vitest process; `setupFiles` runs per worker thread.

## HTTP request helpers

Everything is built on native `fetch` — no extra dependency, no special wire format.

### URL resolution

```ts
import { getTestServerUrl } from "@warlock.js/core";

const url = getTestServerUrl();  // → "http://localhost:2031" (defaults)
```

Reads `http.host` (default `"localhost"`) and `http.port` (default `2031`) from config. If you change the HTTP config, helpers follow automatically.

### Verb helpers

```ts
import {
  testRequest,
  testGet,
  testPost,
  testPut,
  testPatch,
  testDelete,
} from "@warlock.js/core";

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
import { expectJson, parseJsonResponse } from "@warlock.js/core";

// Parse-only
const body = await parseJsonResponse<MyShape>(response);

// Assert status + parse in one call
const body = await expectJson<MyShape>(response);          // expects 200
const body = await expectJson<MyShape>(response, 201);     // expects 201
const body = await expectJson<MyShape>(response, 404);     // expects 404 (testing error paths)
```

`expectJson` throws with the actual status + response body when the assertion fails — no chasing "got 500" messages without context.

## Patterns

### Happy path — create + read

```ts
import { describe, expect, it } from "vitest";
import { expectJson, testGet, testPost } from "@warlock.js/core";

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
  const response = await testPost("/products", { name: "" });  // price missing
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
  const { accessToken } = await authService.generateTokens(user);

  const response = await testGet("/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
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

  const { accessToken } = await authService.generateTokens(user);
  return { user, accessToken, authHeader: { Authorization: `Bearer ${accessToken}` } };
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
- **Port conflicts.** If `http.port` matches your running dev server, `startHttpTestServer()` fails to bind. Either stop the dev server or set a test-only port: `http: { port: 3999 }` in a test-config branch.
- **Auth tokens need a real user.** Generating a JWT with a non-existent `user_id` works — but the auth middleware's user-loading step will reject the request with 401 because it can't find the user in the DB.
- **`expectJson` parses the body once.** If you call it twice on the same response, the second call gets an already-consumed stream error. Capture the result.
- **The HTTP server's connection is NOT torn down between test files.** Data persists across files within a single `vitest` run. Either truncate in `afterEach` / `afterAll`, or design your tests to be order-independent.
- **No HMR / file watching.** Editing a controller during a watch run does NOT reload the HTTP server — restart `vitest --watch` to pick up controller changes. The dev server is the place for live reloading; the test server is intentionally minimal.

## See also

- [`test-service/SKILL.md`](../test-service/SKILL.md) — pure unit tests against services/repositories/models (no HTTP).
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — the controller shape your HTTP tests are exercising.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout, where `tests/*.test.ts` files live.
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — `warlock add test` scaffolds both global + worker setup files.
