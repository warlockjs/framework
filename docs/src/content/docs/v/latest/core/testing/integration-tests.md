---
title: "Integration tests"
description: End-to-end walkthrough — install the test feature, wire global + worker setup, write the first controller test against a real HTTP server, layer auth, and structure the suite as the module grows.
sidebar:
  order: 2
  label: "Integration tests"
---

You've got a CRUD module shipped. The unit tests cover the service layer. Now you want to assert the full route — middleware, validation, controller, response shape — over a real HTTP request. This recipe walks the full path from "I haven't installed test support yet" to "I have an integration test suite for a controller."

We'll test a `products` controller. Substitute your own module name as you read.

## Step 1 — Install test support

```bash
yarn warlock add test
```

That command drops three files into the project:

```
src/test-global-setup.ts    ← starts the HTTP server once per vitest run
src/test-setup.ts           ← runs setupTest in each worker
vite.config.ts              ← wires globalSetup + setupFiles, sets the include pattern
```

It also adds `vitest`, `@vitest/coverage-v8`, `vite`, `@mongez/vite` to `devDependencies`, and registers four scripts in `package.json`:

```json
"test": "vitest",
"test:coverage": "vitest --coverage",
"test:ui": "vitest --ui",
"test:watch": "vitest --watch"
```

You don't need to edit any of the three generated files for a basic suite. The defaults are correct.

## Step 2 — Verify the bootstrap

The generated files should look like this. Confirm they match before you write the first test:

```ts title="src/test-global-setup.ts"
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core";

export async function setup() {
  await startHttpTestServer();
}

export async function teardown() {
  await stopHttpTestServer();
}
```

```ts title="src/test-setup.ts"
import { setupTest } from "@warlock.js/core";

await setupTest({ connectors: true });
```

```ts title="vite.config.ts"
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [mongezVite()],
  test: {
    globalSetup: "./src/test-global-setup.ts",
    setupFiles: ["./src/test-setup.ts"],
    environment: "node",
    globals: false,
    include: ["src/app/**/*.test.ts"],
  },
});
```

The split matters: `globalSetup` runs ONCE in the main vitest process (boots the HTTP server); `setupFiles` runs in each worker thread (gives each worker its own DB connection for direct calls).

## Step 3 — Write the first test

Drop a file under `src/app/products/tests/`:

```ts title="src/app/products/tests/products.controller.test.ts"
import { describe, expect, it } from "vitest";
import { expectJson, testGet } from "@warlock.js/core";

describe("GET /products", () => {
  it("returns 200 with an array", async () => {
    const response = await testGet("/products");
    const body = await expectJson<{ products: unknown[] }>(response);

    expect(Array.isArray(body.products)).toBe(true);
  });
});
```

Run it:

```bash
yarn test products.controller
```

The HTTP server boots in the main process, your worker thread spawns, the test fires a `GET /products` over `fetch`, the controller runs, and the response gets parsed. If the route doesn't exist yet, you get a clear `Expected status 200, got 404` failure — `expectJson` includes the response body in the error message so you can see what came back.

## Step 4 — Add a create-and-read flow

```ts
import { authService } from "@warlock.js/auth";
import { expectJson, testGet, testPost } from "@warlock.js/core";
import { User } from "../../users/models/user";

describe("POST /products", () => {
  it("creates a product and returns it", async () => {
    const user = await User.create({
      email: `creator-${Date.now()}@e.com`,
      password: "secret",
    });
    const { accessToken } = await authService.generateTokens(user);

    const create = await testPost(
      "/products",
      { name: "Test Pen", price: 5 },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const { product } = await expectJson<{
      product: { id: string; name: string };
    }>(create, 201);

    expect(product.name).toBe("Test Pen");

    // Read back over HTTP
    const list = await testGet("/products");
    const { products } = await expectJson<{
      products: Array<{ id: string }>;
    }>(list);

    expect(products.some((p) => p.id === product.id)).toBe(true);
  });
});
```

Three things worth pulling out:

1. **The user is created from the worker.** `User.create(...)` uses the worker's DB connection. The HTTP server has its own connection but reads from the same physical DB, so the row is visible.
2. **The token comes from `authService`.** Don't hand-craft JWTs — the auth middleware loads the user by ID from the token, so the user must exist in the DB and the token signature must match the configured secret.
3. **`expectJson<T>(response, status)` does double duty.** It asserts the status code AND parses the typed body in one call. The generic gives you autocomplete on the result.

## Step 5 — Test the validation path

```ts
describe("POST /products — validation", () => {
  it("rejects missing required fields with 400", async () => {
    const response = await testPost("/products", { name: "" });
    const body = await expectJson<{ errors: Array<{ key: string }> }>(response, 400);

    expect(body.errors.some((e) => e.key === "name")).toBe(true);
    expect(body.errors.some((e) => e.key === "price")).toBe(true);
  });

  it("rejects negative price", async () => {
    const response = await testPost("/products", { name: "Pen", price: -1 });
    const body = await expectJson<{ errors: Array<{ key: string }> }>(response, 400);

    expect(body.errors.some((e) => e.key === "price")).toBe(true);
  });
});
```

The validation middleware sits between routing and the controller. These tests exercise it without your test having to know its internals — you just assert "400 with the error shape Warlock guarantees."

## Step 6 — Hoist an auth helper

When most of your tests need a logged-in user, the bearer-token boilerplate gets repetitive. Pull it into a helper:

```ts title="src/test-utils/auth-test-helpers.ts"
import { authService } from "@warlock.js/auth";
import { User } from "src/app/users/models/user";

export async function createUserAndToken(overrides: Partial<{ email: string }> = {}) {
  const user = await User.create({
    email: overrides.email ?? `user-${Date.now()}@e.com`,
    password: "test-secret",
  });

  const { accessToken } = await authService.generateTokens(user);

  return {
    user,
    accessToken,
    authHeader: { Authorization: `Bearer ${accessToken}` },
  };
}
```

Then your tests get a lot shorter:

```ts
const { authHeader } = await createUserAndToken();

const response = await testPost(
  "/products",
  { name: "Pen", price: 5 },
  { headers: authHeader },
);
```

The `Date.now()` in the email is a cheap way to keep tests parallel-safe — different files get different emails, so the unique constraint on `email` doesn't bite.

## Step 7 — Clean up between tests

Vitest doesn't wrap test files in transactions, so data persists across tests within the run. For most cases an `afterEach` truncate is enough:

```ts
import { afterEach } from "vitest";
import { Product } from "../models/product";

afterEach(async () => {
  await Product.query().delete();
});
```

If your controller writes to multiple models (orders + line items + inventory adjustments), truncate them in dependency order to avoid FK violations:

```ts
afterEach(async () => {
  await LineItem.query().delete();
  await Order.query().delete();
});
```

Tests inside one file run sequentially within a worker, so `afterEach` is enough for intra-file isolation. Cross-file isolation is handled by Vitest's parallel-file model — separate workers, separate test data sets per file.

## Step 8 — Test the error paths

For a controller that throws domain errors:

```ts title="src/app/products/services/get-product.service.ts"
import { ResourceNotFoundError } from "@warlock.js/core";

export async function getProductService(id: string) {
  const product = await productsRepository.find(id);
  if (!product) throw new ResourceNotFoundError("product.notFound");
  return product;
}
```

The HTTP test:

```ts
it("returns 404 when product not found", async () => {
  const response = await testGet("/products/nonexistent_id");
  await expectJson(response, 404);
});
```

The framework's error middleware translates `ResourceNotFoundError` to a 404 response. You don't need to test the middleware's translation — you test the contract: "non-existent ID → 404."

## Step 9 — Organize the suite as it grows

For a module with many controller tests, group by route:

```
src/app/products/tests/
  products.controller.list.test.ts        ← GET /products
  products.controller.create.test.ts      ← POST /products
  products.controller.update.test.ts      ← PATCH /products/:id
  products.controller.delete.test.ts      ← DELETE /products/:id
```

Or by behavior:

```
src/app/products/tests/
  products.controller.happy-path.test.ts
  products.controller.validation.test.ts
  products.controller.auth.test.ts
  products.controller.errors.test.ts
```

Either works. The first is easier to find when you're fixing a specific endpoint. The second is easier to scan when you're reviewing test coverage for a cross-cutting concern.

## Common pitfalls

- **`globalSetup` failed silently → all tests get `fetch failed`.** Check that `src/test-global-setup.ts` exports `setup` and `teardown` (not default exports). A typo in the export name = no error at compile time, just every HTTP test failing.
- **Port conflict with running dev server.** If `yarn start` is running on `:2031`, the test server can't bind. Stop the dev server or set a test-only port: `http: { port: 3999 }` in your config when `Application.environment === "test"`.
- **JWT signed against a different secret.** Make sure `JWT_SECRET` (or whatever your auth config reads) is in `.env`. The test server reads the same env as the dev server — no `.env.test` overlay by default.
- **`User.create(...)` for fixtures hits the `useHashedPassword()` transformer.** Pass the plain password; the model hashes it on save. Tokens generated via `authService` use the hashed password from the DB, so the round-trip is consistent.
- **Don't `await testPost(...)` once and reuse `response`.** `Response.json()` consumes the body stream — call `expectJson` (or `parseJsonResponse`) at most once per response.

## Where to go from here

- For pure unit tests against services/repos/models (no HTTP), see the [Testing guide → Mode 1](../testing/testing.md#mode-1--unit-tests) and `test-service/SKILL.md`.
- For the full HTTP helper reference, see `test-http/SKILL.md`.
- For mail tests (assert "the welcome email got sent"), see the [Mail guide → Test mailbox](../digging-deeper/mail.md).
