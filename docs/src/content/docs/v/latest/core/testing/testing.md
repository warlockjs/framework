---
title: "Testing"
description: How Warlock tests work — the two-worlds model (per-worker bootstrap + one global HTTP server), `setupTest` for unit tests, `startHttpTestServer` for integration tests, and the helpers that make HTTP assertions readable.
sidebar:
  order: 1
  label: "Testing"
---

Warlock tests run on Vitest, and the framework ships a small layer on top that gives you two distinct testing modes: **unit tests** that call services / repositories / models directly, and **integration tests** that hit a real HTTP server over fetch. Each mode has its own bootstrap.

This guide explains the architecture, then walks both modes end-to-end.

## The 30-second look

```bash
# One command from a fresh project — drops vite.config.ts, test-global-setup.ts, test-setup.ts
yarn warlock add test

# Run the suite
yarn test

# Watch mode while you work
yarn test:watch
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

| Value                    | Boots                                  | Use when                            |
| ------------------------ | -------------------------------------- | ----------------------------------- |
| `true` *(default)*       | All Early-phase connectors **except `http`** (db, cache, logger, …) | Most service / model tests. Sensible default. |
| `false`                  | Nothing                                | Pure logic with no framework subsystem touches. |
| `["database", "cache"]`  | Only those, in that order              | A narrow test that needs DB but not, say, storage. |

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

    await expect(placeOrderService({ cart_id: cart.id })).rejects.toThrow(
      /empty/i,
    );
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
    const { accessToken } = await authService.generateTokens(user);

    const response = await testPost(
      "/products",
      { name: "Pen", price: 5 },
      { headers: { Authorization: `Bearer ${accessToken}` } },
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

## Picking the right mode

| You're testing                                | Mode                                   |
| --------------------------------------------- | -------------------------------------- |
| A service / use-case / repository in isolation | Unit (`test-service`)                 |
| A model's transformers / accessors / hooks    | Unit                                   |
| A util function with no DB                    | Unit with `connectors: false`          |
| A route's auth / validation / response shape  | HTTP (`test-http`)                     |
| Multi-controller flow (e.g. order placement → notification) | HTTP                       |
| Error response status codes                   | HTTP                                   |

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
yarn test                  # one-shot run
yarn test:watch            # watch mode
yarn test:coverage         # with v8 coverage
yarn test:ui               # vitest UI
```

You can scope down with vitest's filename or test-name filters:

```bash
yarn test create-product           # files matching "create-product"
yarn test -t "creates a product"   # test name pattern
```

## Caveats and trade-offs

- **The two-worlds connection split is intentional.** Don't fight it by trying to share connections — it would deadlock test parallelism. Instead, design tests so the worker write commits before the HTTP read.
- **Test data persists across files unless you clean it up.** Vitest doesn't wrap test files in transactions. Use `afterEach` truncates or design idempotent fixtures.
- **The HTTP server is started in dev mode (`runtimeStrategy: development`).** That's so routes get re-resolved properly under the framework's dev orchestrator. It's still a real server with real routing — just not the production builder pipeline.
- **No mocks shipped.** No `mockMail`, no `mockHttp`. The mail subsystem has its own [test mailbox](../digging-deeper/mail.md) (`setMailMode("test")` + helpers); for everything else, you're calling real implementations. If you need mocks for an external API (OpenAI, Stripe), vitest's `vi.mock(...)` works fine.

## See also

- `test-service/SKILL.md` — per-task playbook for unit tests.
- `test-http/SKILL.md` — per-task playbook for HTTP integration tests.
- [Integration test recipe](../recipes/integration-tests.md) — end-to-end walkthrough of testing a CRUD controller.
- [`warlock add` features](../cli/cli-commands.md) — what `warlock add test` installs.
