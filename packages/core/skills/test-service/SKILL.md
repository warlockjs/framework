---
name: test-service
description: 'Pure unit tests against services, repositories, models, and use-cases — `setupTest({ connectors })` bootstraps each Vitest worker with its own DB/cache connections so you can call your code directly. Triggers: `setupTest`, `src/test-setup.ts`, `tests.connectors`, `Application.setEnvironment`; "unit-test a service", "test a repository query", "vitest setupFiles", "skip connectors for pure-logic tests"; typical import `import { setupTest } from "@warlock.js/core"`. Skip: HTTP integration — `@warlock.js/core/test-http/SKILL.md`; warlock add test scaffold — `@warlock.js/core/write-cli-command/SKILL.md`; competing tooling: jest direct, `supertest`, `nock`.'
---

# Warlock — test a service

For unit tests, you import the thing under test and call it directly. No HTTP, no fetch, no controllers. Framework testing in Warlock is about getting your **service layer** under test efficiently — and that means each Vitest worker needs its own bootstrapped framework with a DB connection.

`setupTest()` is the one-call bootstrap that gives each worker that environment.

## The shape

```ts title="src/app/users/tests/register-user.service.test.ts"
import { beforeAll, describe, expect, it } from "vitest";
import { registerUserService } from "../services/register-user.service";
import { usersRepository } from "../repositories/users.repository";

describe("registerUserService", () => {
  it("creates a user with hashed password", async () => {
    const user = await registerUserService({
      email: "test@example.com",
      password: "secret",
    });

    expect(user.get("email")).toBe("test@example.com");
    expect(user.get("password")).not.toBe("secret");  // hashed by useHashedPassword()

    const found = await usersRepository.first({ email: "test@example.com" });
    expect(found).toBeDefined();
  });
});
```

No `beforeAll(setupTest)` in this file — the project's `src/test-setup.ts` (registered as `setupFiles` in `vite.config.ts`) already ran it once per worker before any test executed.

## `setupTest({ connectors })` — the worker bootstrap

```ts
import { setupTest } from "@warlock.js/core";

await setupTest({ connectors: true });
```

What it does (in order):

1. Sets `Application.setEnvironment("test")`.
2. Loads `warlock.config.ts`.
3. Runs `bootstrap()` — env, app, prestart hooks.
4. Initializes the `filesOrchestrator` (module/route/config discovery, no file watching).
5. Loads all `src/config/*.ts` files.
6. Reads `tests.connectors` from config (overrides the parameter if set).
7. Starts the chosen connectors — but **never `http`** when you pass a boolean. HTTP is the global-setup's job.

The result: each worker has its own DB/cache/logger/storage connections. Models save, repositories query, services run. Same code as production, just isolated to the test process.

### The `connectors` parameter

| Value                  | Boots                                                            | Use when                                              |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `true` *(default)*     | Every connector except `http` — via `startWithout(["http"])` (db, cache, logger, storage, and socket if configured) | Most service / repository / model tests.              |
| `false`                | None                                                             | Pure logic tests with no DB / cache touches (parsers, validators, util functions). |
| `["database", "cache"]` | Just those, in that order                                        | A test that only needs DB but not, say, the storage driver. |

The default `true` is the sane choice. Reach for `false` when the unit you're testing genuinely doesn't talk to any framework subsystem — pulling up a DB connection per worker just to test a string parser is wasted setup time.

### Override via config — `src/config/tests.ts`

```ts title="src/config/tests.ts"
const testsConfigurations = {
  connectors: ["database", "logger"],
};

export default testsConfigurations;
```

If `tests.connectors` is set, **it wins over the `setupTest({ connectors })` parameter**. Use this when every test file in the project agrees on the same minimal connector list — saves repeating the explicit array in `test-setup.ts`.

## Project wiring — `src/test-setup.ts` + `vite.config.ts`

The `warlock add test` feature creates both files. The standard wiring:

```ts title="src/test-setup.ts"
/**
 * Per-Worker Test Setup
 * Runs in EACH Vitest worker thread before tests execute.
 */
import { setupTest } from "@warlock.js/core";

await setupTest({ connectors: true });
```

```ts title="vite.config.ts"
import { lowerStage3Decorators } from "@warlock.js/core";
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [lowerStage3Decorators(), mongezVite()],
  test: {
    globalSetup: "./src/test-global-setup.ts",  // ← HTTP server (see test-http skill)
    setupFiles: ["./src/test-setup.ts"],         // ← runs setupTest per worker
    environment: "node",
    globals: false,
    include: ["src/app/**/*.test.ts"],
  },
});
```

The `mongezVite()` plugin handles TypeScript path resolution and the framework's module shape. Without it, your imports break the moment vitest tries to load a Warlock module. `lowerStage3Decorators()` goes **first** — it lets decorated Cascade models (`@RegisterModel`, …) load under Vitest 4 / Vite 8; see [`@warlock.js/core/lower-stage3-decorators/SKILL.md`](@warlock.js/core/lower-stage3-decorators/SKILL.md).

Tests live colocated with the module: `src/app/<module>/tests/*.test.ts`. The `include` pattern picks them up.

## Patterns

### Testing a service that talks to the DB

```ts title="src/app/products/tests/create-product.service.test.ts"
import { describe, expect, it } from "vitest";
import { Product } from "../models/product";
import { createProductService } from "../services/create-product.service";

describe("createProductService", () => {
  it("persists the product and sets a slug", async () => {
    const product = await createProductService({
      name: "Test product",
      price: 99,
    });

    expect(product.id).toBeDefined();
    expect(product.get("slug")).toBe("test-product");
  });

  it("rejects duplicate names", async () => {
    await Product.create({ name: "Existing", price: 10 });

    await expect(
      createProductService({ name: "Existing", price: 20 }),
    ).rejects.toThrow(/already exists/i);
  });
});
```

Direct call, direct assert, direct DB read for verification. No mocks — the test runs against the real DB connection that `setupTest` brought up.

### Testing a use-case pipeline

```ts title="src/app/orders/tests/place-order.use-case.test.ts"
import { describe, expect, it } from "vitest";
import { placeOrderUseCase } from "../use-cases/place-order.use-case";

describe("placeOrderUseCase", () => {
  it("runs guards → validation → handler in order", async () => {
    const result = await placeOrderUseCase({
      cart_id: "cart_123",
      payment_method: "card",
    });

    expect(result.order.get("status")).toBe("pending_payment");
  });

  it("aborts if guard throws", async () => {
    await expect(
      placeOrderUseCase({
        cart_id: "empty_cart",
        payment_method: "card",
      }),
    ).rejects.toThrow(/cart is empty/i);
  });
});
```

Use-cases are first-class testable in this layer — no HTTP plumbing in the way.

### Testing a repository query

```ts title="src/app/users/tests/users.repository.test.ts"
import { describe, expect, it } from "vitest";
import { User } from "../models/user";
import { usersRepository } from "../repositories/users.repository";

describe("usersRepository", () => {
  it("findActiveByEmail returns only non-deleted users", async () => {
    const active = await User.create({ email: "a@e.com", deleted_at: null });
    const deleted = await User.create({ email: "b@e.com", deleted_at: new Date() });

    const found = await usersRepository.findActiveByEmail("a@e.com");
    expect(found?.id).toBe(active.id);

    const missing = await usersRepository.findActiveByEmail("b@e.com");
    expect(missing).toBeNull();
  });
});
```

### Cleaning up between tests

```ts
import { afterEach } from "vitest";
import { User } from "../models/user";

afterEach(async () => {
  await User.query().delete();
});
```

Vitest runs tests in a single worker file sequentially, so an `afterEach` truncate gives each test a clean slate. For cross-file isolation, run the suite with `vitest --pool=forks --maxWorkers=N` and rely on the per-worker connection — each file's data stays within its worker until the run ends.

### Skipping connectors for pure logic tests

```ts title="src/app/utils/tests/slugify.test.ts"
import { beforeAll, describe, expect, it } from "vitest";
import { setupTest } from "@warlock.js/core";
import { slugify } from "../utils/slugify";

beforeAll(async () => {
  await setupTest({ connectors: false });  // override the project default
});

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
});
```

`setupTest` is idempotent per worker (`isSetupComplete` flag) — calling it again with different options after `src/test-setup.ts` already ran is a no-op. To genuinely skip connectors, either set `tests.connectors: false` in config (project-wide) or rely on the default in `src/test-setup.ts` being what you want most of the time.

## Gotchas

- **`setupTest` is idempotent per worker.** Second + later calls early-return. You can't "swap" the connector set mid-run — the first call wins, including the one in `src/test-setup.ts`. Choose your worker default carefully.
- **Per-worker connections are separate from the HTTP server's connections.** A row inserted by a service-level test is on the worker's connection; the HTTP test server has its own. They don't see each other unless they're both pointing at the same physical DB and the inserting test has already committed.
- **`NODE_ENV` is set to `"test"`** by `setupTest`. Code that branches on `Application.isProduction` / `Application.isDevelopment` sees `false` for both. If your tests need production-like config (cookies, CORS), set those values in `src/config/*.ts` explicitly under the test branch — don't rely on the env flag.
- **No HTTP from this layer.** `setupTest({ connectors: true })` never starts the HTTP connector by design. Don't try to `request.app.http` your way to a fetch test — use the `test-http` skill instead.
- **Don't import `vitest-setup` from `@warlock.js/core/src/...`.** The public surface is `import { setupTest } from "@warlock.js/core"`. Reaching into source paths breaks when the package layout shifts.
- **Test files need the `.test.ts` suffix.** `include: ["src/app/**/*.test.ts"]` is what vitest scans. A file named `service.tests.ts` (plural) silently doesn't run.

## See also

- [`test-http/SKILL.md`](../test-http/SKILL.md) — integration tests via the real HTTP server (`startHttpTestServer` + `testGet` / `testPost` / `expectJson`).
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — where tests live in a module (`tests/*.test.ts`).
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — `warlock add test` for the initial scaffold.
