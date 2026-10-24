---
name: test-service
description: 'Pure unit tests against services, repositories, models, and use-cases — `setupTest({ connectors })` bootstraps the framework with its own DB/cache connections so you can call your code directly, and `teardownTest()` closes it. Triggers: `setupTest`, `teardownTest`, `setupTest({ fakes })`, `tests.fakes`, `src/test-setup.ts`, `tests.connectors`, `tests.setupTimeout`, `Application.setEnvironment`, `clock`, `ids`, `warlock test --changed`; "unit-test a service", "test a repository query", "vitest setupFiles", "skip connectors for pure-logic tests", "run only the tests my change affects", "deterministic time in a test"; typical import `import { setupTest, teardownTest } from "@warlock.js/core/tests"`. Skip: HTTP integration — the `test-http` topic; warlock add test scaffold — the `write-cli-command` topic; competing tooling: jest direct, `supertest`, `nock`.'
---

# Warlock — test a service

For unit tests, you import the thing under test and call it directly. No HTTP, no fetch, no controllers. Framework testing in Warlock is about getting your **service layer** under test efficiently — and that means your tests need a bootstrapped framework with a DB connection.

`setupTest()` is the one-call bootstrap that provides that environment; `teardownTest()` closes it.

⚠ **Corrected in 4.14.0 — `setupTest` is CALLED once per TEST FILE, not once per worker.** Every version of this skill through 4.13.0 said "per worker", the generated `src/test-setup.ts` carries a `Per-Worker Test Setup` comment saying the same thing, and **both were wrong.** Vitest runs `setupFiles` before **each test file**, and the setup module's registry is rebuilt every time — measured across all four `pool` × `isolate` combinations.

⛔ **If your project was generated before 4.14.0, fix BOTH the comment and the call.** The comment is false, **and** the generated `setupTest({ connectors: true })` is now an _explicit_ value that overrides your `src/config/tests.ts`. **Bare `setupTest()` is the correct call.**

**The default lifetime is FILE-SCOPED.** Your setup file bootstraps the framework and its `afterAll(teardownTest)` closes it, once per test file. **One owner, one pairing — correct under every pool, every isolation setting, and watch mode.**

Worker lifetime is available as an opt-in in 5.35.0. See the runtime lifetime section below for its runner, pool and isolation requirements.

⚠ **Changed in 4.13.0 — the import is a subpath now.** `setupTest` used to be re-exported from the package root; it is not any more, because that put the test helpers into every application's production module graph. `import { setupTest } from "@warlock.js/core"` now fails with _"has no exported member"_ — **add `/tests` to the specifier and nothing else changes.**

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
    expect(user.get("password")).not.toBe("secret"); // hashed by useHashedPassword()

    const found = await usersRepository.first({ email: "test@example.com" });
    expect(found).toBeDefined();
  });
});
```

No `beforeAll(setupTest)` in this file — the project's `src/test-setup.ts` (registered as `setupFiles` in `vite.config.ts`) already ran it **before this file's tests executed**, as it does before every test file.

## `setupTest({ connectors })` — the bootstrap

```ts
import { setupTest } from "@warlock.js/core/tests";

await setupTest({ connectors: true });
```

What it does (in order):

1. Sets `Application.setEnvironment("test")`.
2. Loads `warlock.config.ts`.
3. Runs `bootstrap()` — env, app, prestart hooks.
4. Initializes the `filesOrchestrator` (module/route/config discovery, no file watching).
5. Loads all `src/config/*.ts` files.
6. Resolves the connector selection — **an explicit parameter wins, then `tests.connectors` from config, then the `true` default.** See _Selecting connectors_ below.
7. Starts the chosen connectors — but **never `http`** when you pass a boolean. HTTP is the global-setup's job.

The result: DB/cache/logger/storage connections your code can use. Models save, repositories query, services run. Same code as production, just isolated to the test process.

### The `connectors` parameter

| Value                   | Boots                                                                                                               | Use when                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `true` _(default)_      | Every connector except `http` — via `startWithout(["http"])` (db, cache, logger, storage, and socket if configured) | Most service / repository / model tests.                                           |
| `false`                 | None                                                                                                                | Pure logic tests with no DB / cache touches (parsers, validators, util functions). |
| `["database", "cache"]` | Just those, in that order                                                                                           | A test that only needs DB but not, say, the storage driver.                        |

The default `true` is the sane choice. Reach for `false` when the unit you're testing genuinely doesn't talk to any framework subsystem — pulling up a DB connection **for every file** just to test a string parser is wasted setup time.

### Selecting connectors — `src/config/tests.ts`

```ts title="src/config/tests.ts"
const testsConfigurations = {
  connectors: ["database", "logger"],
};

export default testsConfigurations;
```

⚠ **BREAKING in 4.14.0 — the precedence flipped.**

|                        | Order                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| **4.13.0 and earlier** | `tests.connectors` config **>** `setupTest({ connectors })` parameter **>** `true`              |
| **4.14.0 onward**      | **explicit `setupTest({ connectors })` parameter** **>** `tests.connectors` config **>** `true` |

**An explicit call-site value now beats project config.** If your project sets `tests.connectors` _and_ some test file passes `connectors` explicitly, **that file will start a different connector set after upgrading.** Search for `setupTest({` across your tests before you upgrade — a call passing `connectors` was previously ignored and is now honoured.

**"Explicit" means you supplied a non-`undefined` value.** Both of these fall through to config:

```ts
await setupTest(); // → tests.connectors, else true
await setupTest({}); // → tests.connectors, else true
await setupTest({ connectors: undefined }); // → tests.connectors, else true — NOT "start none"
```

The `undefined` rule is deliberate: an optional variable that happens to be `undefined` must not silently erase your project config.

```ts
await setupTest({ connectors: false }); // → none, even if config says otherwise
await setupTest({ connectors: ["database"] }); // → exactly that, even if config differs
```

⚠ **The generated `src/test-setup.ts` calls `setupTest()` with no argument, on purpose.** If you "helpfully" change it to `setupTest({ connectors: true })`, you have made it explicit and **erased the `tests.connectors` layer for the whole project.**

Use `tests.connectors` when every test file agrees on the same minimal list — it saves repeating the array, and individual files can still override it.

## Project wiring — `src/test-setup.ts` + `vite.config.ts`

The `warlock add test` feature creates both files. The standard wiring:

```ts title="src/test-setup.ts"
/**
 * Test Setup
 * Runs before EACH test file — not once per worker.
 */
import { afterAll } from "vitest";
import { setupTest, teardownTest } from "@warlock.js/core/tests";

await setupTest();
afterAll(teardownTest);
```

⛔ **Three things changed here in 4.14.0. If you generated this file earlier, replace all three — it is not a comment fix.**

1. **`afterAll(teardownTest)` is new and mandatory.** Nothing else closes the framework your tests started. This is what makes the lifetime file-scoped and owned rather than left running.
2. **The call is now bare `setupTest()`, not `setupTest({ connectors: true })`.** Under the flipped precedence, passing `true` is an _explicit_ value and would override `tests.connectors` for **every file in the project.** Bare means "whatever this project configured, else the default".
3. **The comment used to say `Per-Worker Test Setup` / "Runs in EACH Vitest worker thread".** False — see the top of this skill.

```ts title="vite.config.ts"
import { lowerStage3Decorators } from "@warlock.js/core/vite";
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [lowerStage3Decorators(), mongezVite()],
  test: {
    globalSetup: "./src/test-global-setup.ts", // ← HTTP server (see test-http skill)
    setupFiles: ["./src/test-setup.ts"], // ← runs setupTest before EACH test file
    environment: "node",
    globals: false,
    include: ["src/app/**/*.test.ts"],
  },
});
```

The `mongezVite()` plugin handles TypeScript path resolution and the framework's module shape. Without it, your imports break the moment vitest tries to load a Warlock module. `lowerStage3Decorators()` goes **first** — it lets decorated Cascade models (`@RegisterModel`, …) load under Vitest 4 / Vite 8; see the `lower-stage3-decorators` topic.

With Vitest 5 projects, list the plugin only in the root config: inline projects
extend the file that declares them by default, and repeating it inside a project
makes Vitest warn `applies the same plugin multiple times`. Use `extends: true`
(inherit, the generated layout) or `extends: false` (own plugins) explicitly.

### Keep Vitest setup out of development

`warlock dev` (and `warlock build`) load your app's `vite.config.ts`. Anything you put there for tests runs in development too. Guard vitest-only setup:

```ts
// vite.config.ts
if (process.env.VITEST) {
  Object.assign(process.env, testEnv); // test database, test keys...
}
```

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

    await expect(createProductService({ name: "Existing", price: 20 })).rejects.toThrow(
      /already exists/i,
    );
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

Vitest runs the tests within one file sequentially, so an `afterEach` truncate gives each test a clean slate.

⚠ **Cross-_file_ isolation is not solved by this.** Separate workers get separate **connections**, not separate **rows** — two files pointed at the same database see each other's committed data regardless of pool or worker count. **Truncate what your file wrote; don't assume the worker boundary did it for you.** Real data isolation (DB-per-worker, transaction-per-test) is a separate piece of work and is not in this release.

### Skipping connectors for pure logic tests

```ts title="src/app/utils/tests/slugify.test.ts"
import { beforeAll, describe, expect, it } from "vitest";
import { setupTest } from "@warlock.js/core/tests";
import { slugify } from "../utils/slugify";

beforeAll(async () => {
  await setupTest({ connectors: false }); // starts no connectors at all
});

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
});
```

⛔ **BREAKING in 4.14.0 — the example above now REJECTS if your project has a `src/test-setup.ts`.**

Through 4.13.0 a second `setupTest` call with different options was a **silent no-op** — you asked for no connectors, got all of them, and nothing told you. In 4.14.0 a conflicting call **rejects with an error naming both the active and the requested selection**, because silently ignoring what you asked for is worse than failing.

**If `src/test-setup.ts` already ran `setupTest()` in this file, use one of these instead:**

```ts
// 1. Tear down first, then set up differently — and PUT IT BACK when the file ends.
import { afterAll, beforeAll } from "vitest";
import { setupTest, teardownTest } from "@warlock.js/core/tests";

beforeAll(async () => {
  await teardownTest();
  await setupTest({ connectors: false });
});

afterAll(async () => {
  await teardownTest(); // ← REQUIRED, see below
});
```

⛔ **The `afterAll` is not optional** — without it you leave a `connectors: false` runtime ready when the file ends.

⚠ **This pattern interacts with the `afterAll(teardownTest)` in your setup file, and the relative ordering of the two has not been verified.** `teardownTest` is idempotent, so whichever runs second finds an idle lifecycle and no-ops — but **do not build anything on a particular order until someone has measured it.** This is the strongest argument for option 2 below.

```ts
// 2. Or don't call setupTest at all — a pure-logic test needs nothing from it.
//    The connectors your setup file started are already running; you simply don't use them.
```

**3. Or set `tests.connectors: false` in `src/config/tests.ts`** if no test file in the project needs connectors.

**Option 2 is usually right, and option 1 is easy to get wrong.** Tearing down and re-bootstrapping costs a full framework startup — twice, once for your file and once for the next — to avoid a DB connection you were never going to use. **Reach for option 1 only when a connector's mere presence breaks the thing you're testing**, not to save setup time.

## Fakes are on — `setupTest({ fakes })`

Once its connectors are up, `setupTest()` installs the test fakes — mail, queue, cache, storage, clock and ids — and `teardownTest()` restores them first, while the real drivers are still connected. A service under test therefore sends no mail, pushes no job to Redis, uploads nothing and reads a frozen `clock`:

```ts
// with: import { clock } from "@warlock.js/core";
//       import { clockFake, mailFake } from "@warlock.js/core/tests";
//       plus your service (issueResetToken, isResetTokenValid)
it("expires a reset token after 15 minutes", async () => {
  const token = await issueResetToken("ada@example.test"); // expiresAt = clock.timestamp() + 15 min

  clockFake.travel(16 * 60_000);

  expect(await isResetTokenValid(token)).toBe(false);
  expect(clock.now().toISOString()).toBe("2026-01-01T00:16:00.000Z");
  mailFake.assertSent({ to: "ada@example.test" });
});
```

Precedence is `explicit option > tests.fakes config > true`. Opt out in `src/config/tests.ts` (`fakes: false`, or `fakes: { cache: false }`) or per call (`setupTest({ importModule, fakes: false })`). The full assertion API is the `test-fakes` topic; deterministic fixtures are `model-factories`.

## Running only what changed — `warlock test`

```bash
warlock test --changed                # tests affected by uncommitted changes
warlock test --changed --since main   # ... by changes since main
warlock test --related src/app/posts/services/create-post.service.ts
warlock test --json                   # Vitest's JSON report on stdout
```

It runs the project's own Vitest with `NODE_ENV=test`; a change that affects no test passes (`--passWithNoTests`).

## Lifecycle and repeated calls

`setupTest` / `teardownTest` are a pair. **The harness that calls one owns calling the other in the same context.**

| Call                                                                        | Behaviour                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `setupTest(x)` while idle                                                   | bootstraps                                           |
| `setupTest(x)` while already ready with the **same** effective options      | no-op                                                |
| `setupTest(y)` while ready or starting with **different** effective options | ⛔ **rejects**, naming active vs requested           |
| two concurrent `setupTest(x)` calls                                         | share one startup                                    |
| `setupTest` after a failed setup                                            | allowed — a failed setup unwinds and returns to idle |
| `teardownTest()` while idle                                                 | no-op                                                |
| two concurrent `teardownTest()` calls                                       | share one shutdown                                   |
| `setupTest(y)` after a **successful** teardown                              | allowed, different options fine                      |

**"Same options" is compared by meaning, not by literal value** — connector arrays are deduplicated and compared as sets, so `["cache", "database"]` and `["database", "cache", "cache"]` are the same selection.

⚠ **A failed shutdown poisons the lifecycle.** If `teardownTest()` rejects because the shutdown layer reported a failure, later `setupTest` calls **refuse until the Vitest worker is recycled** or a retried teardown fully succeeds. This is deliberate: a cleared flag does not prove that ports, sockets, pools or timers actually closed, and pretending otherwise hands you a "clean" run built on a leaked runtime.

⚠ **What it cannot detect:** `connectorsManager.shutdown()` catches and logs individual connector failures internally. Those never reach this lifecycle, so they never poison it. It surfaces what that layer reports — no more.

### `tests.setupTimeout` — the setup attempt is bounded

**New in 4.14.0.** A setup attempt that never settles used to leave the lifecycle stuck in `starting` and take the worker down with an out-of-memory crash. It is now bounded.

```ts title="src/config/tests.ts"
const testsConfigurations = {
  connectors: ["database", "logger"],
  setupTimeout: 120000, // milliseconds — this is the default
};

export default testsConfigurations;
```

**Default: `120000` (two minutes)** — far above a healthy cold start, below the point where you'd stop watching the terminal. When it expires:

```
setupTest() did not finish within 120000ms and is stuck in the "starting" state. The
lifecycle is now poisoned: whatever that attempt had already started is not known to be
closed, so later setupTest() calls refuse until the Vitest worker is recycled. If your
cold start is legitimately slower than this, raise the bound with `tests.setupTimeout`
in `src/config/tests.ts` — milliseconds, default 120000.
```

1. **It bounds the setup ATTEMPT, not teardown separately.** `teardownTest()` awaits the same attempt, so it inherits the bound — **one timer, not two.** A second teardown-side deadline was tried and rejected: it re-introduced the unbounded re-entry this whole guard exists to remove.
2. **Expiry poisons the lifecycle**, it does not return to `idle`. The attempt may have started connectors nobody can now account for, so pretending the runtime is clean would be worse than refusing.
3. **⛔ An invalid `setupTimeout` throws, naming the bad value.** Zero, negative and non-numeric all fail loudly rather than falling back to the default — a silent fallback would hide a typo behind a working suite.
4. **The bound is measured from when the attempt started**, not from when config was read. `tests.setupTimeout` is only readable after `loadConfigFiles()`, which happens _inside_ the window being bounded; re-arming naively would give you the default plus your configured value.

⚠ **What is proven and what is not.** The nine guards above were each seen to fail under their own mutation. **But every spec injects its scheduler**, so the default _value_ is tested while the production timer — and whether its `unref` actually releases the worker — is not. **And no spec observes a real hang**: the stuck attempt is a mock gate, not a socket that never returns. These prove what the lifecycle _decides_, not what a genuinely wedged connector does.

### State is per worker runtime, not per module

The lifecycle state lives in the worker runtime, not in a module variable. That matters because **Vitest rebuilds the module registry between test files while the worker itself keeps running** — so a module-level flag resets exactly where live DB connections and pools survive. Scope:

- **`pool: "forks"`** — state is per worker **process**.
- **`pool: "threads"`** — state is per worker **thread**. It does **not** cross threads; `globalThis` is per realm, not per process.

In both cases the guard's scope matches the resource's scope, which is the point.

⚠ **Not guaranteed:** under `threads` with `isolate: true`, Vitest tears the thread down while the process lives on. **Whether Node reclaims that thread's sockets and pools is unmeasured**, and nothing in this lifecycle can observe it.

## Gotchas

When a unit test copies TypeScript source into a temporary directory for a fresh
Node process, preserve the source package's module mode. ESM fixtures need a
`package.json` with `"type": "module"`; otherwise `tsx` can load the copy as
CommonJS and named exports fail before the behavior under test runs. Assert the
child process exit status with its captured stderr before checking stdout.

- **By default `setupTest` boots per test file** — every version of this skill through 4.13.0 said otherwise. **You pay one framework bootstrap per test file**, which is what 4.13.0 already cost; the difference is that it is now a chosen lifetime rather than a side effect of a module flag resetting.
- ⛔ **Never delete the `afterAll(teardownTest)` from your setup file.** Without it nothing closes what `setupTest` opened, and the connectors outlive the file that started them.
- ⛔ **You can't swap the connector set by calling `setupTest` again — it rejects now.** Through 4.13.0 the second call was silently ignored. Tear down first, or don't call it.
- **These connections are separate from the HTTP test server's.** A row inserted by a service-level test is on this connection; the HTTP test server has its own. They only see each other if both point at the same physical DB **and** the inserting test has committed.
- **`setupTest` takes over the process's `connectorsManager` for its lifetime.** Teardown is manager-wide, so **mixing `setupTest` with manually started connectors is unsupported** — teardown may close yours too.
- **`NODE_ENV` is set to `"test"`** by `setupTest`. Code that branches on `Application.isProduction` / `Application.isDevelopment` sees `false` for both. If your tests need production-like config (cookies, CORS), set those values in `src/config/*.ts` explicitly under the test branch — don't rely on the env flag.
- **No HTTP from this layer.** `setupTest({ connectors: true })` never starts the HTTP connector by design. Don't try to `request.app.http` your way to a fetch test — use the `test-http` skill instead.
- **Don't import `vitest-setup` from `@warlock.js/core/src/...`.** The public surface is `import { setupTest } from "@warlock.js/core/tests"`. Reaching into source paths breaks when the package layout shifts.
- **Test files need the `.test.ts` suffix.** `include: ["src/app/**/*.test.ts"]` is what vitest scans. A file named `service.tests.ts` (plural) silently doesn't run.

## See also

- The `test-fakes` topic — every fake and its assertions.
- The `model-factories` topic — `defineFactory()`.
- The `test-http` topic — integration tests via the real HTTP server (`startHttpTestServer` + `testGet` / `testPost` / `expectJson`).
- The `warlock-conventions` topic — where tests live in a module (`tests/*.test.ts`).
- The `write-cli-command` topic — `warlock add test` for the initial scaffold.

## App modules and `importModule`

Under Vitest, test files run through vite-node while Warlock's own native `import()` of app modules (config, routes, events) does not, so app classes such as `User` can exist twice in one worker and `instanceof` fails. Pass `importModule` to `setupTest` so Warlock loads app modules through the test's own module graph:

```ts
setupTest({ importModule: (file) => import(file) });
```

The generated `src/test-setup.ts` already does this. Without it, `setupTest()` under Vitest warns once.

## Runtime lifetime, unit projects and setup profiling

`warlock add test` (also used by `create-warlock --features=test`) generates two
Vitest projects. `unit` discovers `src/**/*.spec.ts` outside `tests/` directories
and has no Warlock setup or HTTP global setup. `integration` discovers
`src/**/*.test.ts`, specs inside `src/**/tests/`, and `tests/**/*.{test,spec}.ts`.
It uses the framework setup, HTTP global setup and a generated `src/test-runner.ts`.
Keep pure service specs beside their source and mock repositories at the boundary.
Existing config files are preserved; copy the projects layout into them manually.
Vitest 5 or newer is required for the generated runner (Vitest 5 removed `vitest/runners`; the runner extends `TestRunner` from `vitest`).

For a unit spec that needs configuration values, use:

```ts
import { afterAll, expect } from "vitest";
import { setupTest, teardownTest } from "@warlock.js/core/tests";

await setupTest({
  mode: "unit",
  importModule: (file) => import(file),
  file: expect.getState().testPath,
});
afterAll(teardownTest);
```

Unit mode loads `warlock.config.ts` and configuration values once per module graph.
It skips bootstrap/env/prestart hooks, connectors, config special handlers,
`filesOrchestrator.init()`, the native ESM loader, and fake installation. Keep
configuration imports free of side effects; arbitrary code imported by a config
file can still perform I/O. A plain unit spec usually needs no `setupTest()` at all.
`connectors: false` still bootstraps; it is not the cheap unit mode. Use separate
projects for unit and integration runtimes.

### Opt into one runtime per fork

The default remains `tests.lifetime: "file"`. To reuse a runtime, change the
integration project's `isolate` to `false`, keep `pool: "forks"` and
`runner: "./src/test-runner.ts"`, then configure:

```ts title="src/config/tests.ts"
import { resetWorkerDatabase } from "../test-database";

export default {
  lifetime: "worker",
  // Application-owned callback: truncate only this worker's test database.
  // Called before every file's fixtures, including the first file.
  resetBetweenFiles: async () => {
    await resetWorkerDatabase();
  },
  profileSetup: true,
};
```

Run with `npx vitest run --project integration`. Worker lifetime refuses watch,
threads, isolated module graphs, or a missing runner with a message explaining
the required settings. Keep `afterAll(teardownTest)` in the setup file: in worker
mode it marks the end of the file; Vitest's awaited worker cleanup closes the
runtime once. The runner uses `TestRunner.onCleanupWorkerContext`, verified
in Vitest 5.0.3's `TestRunner` declaration, runner implementation and worker cleanup source.
For an existing project, generate this runner without overwriting your config:

```ts title="src/test-runner.ts"
import { configureTestWorker } from "@warlock.js/core/tests";
import { TestRunner } from "vitest";

export default class WarlockTestRunner extends TestRunner {
  public constructor(config: ConstructorParameters<typeof TestRunner>[0]) {
    super(config);
    configureTestWorker(
      { pool: this.pool, watch: config.watch, isolate: config.isolate },
      (cleanup) => this.onCleanupWorkerContext?.(cleanup),
    );
  }
}
```

The first file bootstraps; subsequent files reuse connectors and config. Between
files, selected fakes are restored and reinstalled, resetting mail/queue records,
cache, secrets, clock, IDs and a private storage directory. Worker storage is
separate from the global HTTP server's storage: use an in-process test HTTP server
when assertions need to see request-side fake state. The hook runs after fake
reset and before fixtures. It must finish before returning. Within a file,
repeated `setupTest()` calls remain idempotent; use `beforeEach`/`afterEach` for
per-test cleanup.

This trades module isolation for startup cost: application singletons, config
mutations, mocks and module side effects can survive between files. Reset your
own state in `resetBetweenFiles`, restore mocks, and keep connector selection
consistent. Give each worker a distinct database/schema using
`process.env.VITEST_POOL_ID` (1-based since Vitest 5) when preparing test connections. Never drop a shared
database from this hook while other workers are using it. The framework does not
create a memory replica set or a cross-worker lock; those belong to the application's
global setup. A shared HTTP server and a single replica set can contend on I/O,
locks and shared fixtures even though workers run concurrently. Scope rows and
HTTP fixtures per worker, or run tests that require global mutation separately
with `maxWorkers: 1`. No test-server teardown ownership changes are needed here.

`getTestRuntimeStats()` from `@warlock.js/core/tests` returns process-local
`{ bootstraps, files }`. For example, after setup in worker mode:

```ts
import { expect, it } from "vitest";
import { getTestRuntimeStats } from "@warlock.js/core/tests";

it("reuses this worker's runtime", () => {
  expect(getTestRuntimeStats().bootstraps).toBe(1);
});
```

Across one integration project, a successful run with no worker recycling needs
at most `maxWorkers` bootstraps. Multiple projects, worker crashes and memory-limit
recycling can create additional processes; count distinct PIDs in profiles.

### Worker lifetime with the HTTP test server and a database

Two things are shared when a worker keeps its runtime: the database and the
servers a file opened. Both have a built-in reset now.

```ts title="src/config/tests.ts"
export default {
  lifetime: "worker",
  // Truncate every table/collection (the migrations ledger is kept) before each file.
  resetDatabase: true, // or { except: ["countries"] }
};
```

```ts title="src/config/database.ts"
import { workerDatabaseName } from "@warlock.js/core/tests";

// One database per Vitest worker: the reset above may delete every row in it.
const name = process.env.VITEST ? workerDatabaseName("app_test") : "app";
```

- `resetDatabase` runs after the fakes reset and before `resetBetweenFiles`, so
  the hook can seed reference data. `resetTestDatabase({ except, only, connection })`
  is exported for tests and custom hooks. On PostgreSQL it truncates with
  `CASCADE`.
- `workerDatabaseName(base)` returns `base_<VITEST_POOL_ID>`; `testWorkerId()`
  returns the 1-based worker id. Create or migrate that database in the
  application's global setup or in a `bootstrap` step before connectors start.
- Servers from `createTestHttpServer()` that a file did not `close()` are closed
  before the next file, so their routes and ports do not leak. App modules
  (`loadAppModules`) load once per worker and are reused.
- The global `startHttpTestServer()` server runs in Vitest's main process with its
  own connections and fakes. Worker lifetime does not touch it, so keep requests
  through it independent of the worker database, or use `createTestHttpServer()`
  in the worker for tests that read the same database the assertions use.
- `isolate: false` shares module state between files of a worker: singletons,
  `vi.mock()` of app modules and module-level caches survive. Restore mocks in
  `afterEach`, and clear module state in `resetBetweenFiles`.

### Measure and size CI workers

Set `tests.profileSetup: true` or run
`WARLOCK_TEST_PROFILE=1 npx vitest run --project integration`. Pass
`file: expect.getState().testPath` to `setupTest()` for file labels (the generated
setup does this). Each file emits one line with milliseconds for environment, config,
bootstrap, orchestrator, app config, connectors, fakes, reset and teardown as
applicable, plus `body`, the time between setup finishing and teardown starting.
Reused files report reset instead of startup steps. When a file-lifetime run spends
half or more of its time in setup over at least four files, the worker summary and
`TestSetupReporter` print a line recommending worker lifetime. A summary per
worker reports file/bootstrap counts, summed step timings and final shutdown.
The generated config also installs `TestSetupReporter` from `@warlock.js/core/vite`
(`reporters: ["default", new TestSetupReporter()]`), which aggregates file counts,
bootstrap counts and timings across PIDs into a run summary. Summed timings are
not wall time. Worker shutdown is included when its summary reaches the reporter
before the run-end callback; individual worker summaries always report it.

The generated config sets `maxWorkers: recommendedTestWorkers()` from
`@warlock.js/core/vite`. It takes the smaller of CPU affinity and the tightest
visible cgroup v2 quota, rounding fractional CPUs down with a minimum of one.
For example `cpu.max = 1200000 100000` recommends 12 workers on a 48-CPU host.
The format follows the [kernel cgroup v2 CPU interface](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#cpu-interface-files).
It reads `/proc/self/cgroup` and visible ancestors under `/sys/fs/cgroup`; hosts
without readable v2 quotas use affinity. Set `maxWorkers` explicitly on cgroup v1,
custom cgroup mounts, or when database/memory limits require fewer workers.

### Release gate

```bash
npx warlock test --changed --since "$LAST_RELEASE_REF"
npx vitest run --project integration
# Nightly (all projects):
npx vitest run
```

The first command includes affected tests, using the existing changed-test CLI;
the second always covers integration wiring. Keep the full suite nightly and
compare cold and reused setup profiles on the same revision, worker count and
database fixture before claiming a speedup.

For a manual fake harness outside `setupTest`, the same private storage behavior
is available with `await installTestFakes(true, { isolatedStorage: true })`, paired
with `await restoreTestFakes()`. Both are exported from `@warlock.js/core/tests`.
`await storageFake.install({ isolated: true })` / `await storageFake.restore()`
provides it for a storage-only harness. Existing installs share the HTTP root by
default; the isolated option never replaces or deletes that shared root.
