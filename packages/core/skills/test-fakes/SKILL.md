---
name: test-fakes
description: 'The test fakes Warlock installs by default in the test environment — `mailFake`, `queueFake`, `cacheFake`, `storageFake`, `clockFake`, `idsFake`, `secretsFake` — and their assertions (`assertSent`, `assertPushed`, `assertHas`, `assertExists`, `travel`), plus how to opt out (`tests.fakes`, `setupTest({ fakes })`). Triggers: `mailFake`, `queueFake`, `cacheFake`, `storageFake`, `clockFake`, `idsFake`, `secretsFake`, `installTestFakes`, `restoreTestFakes`, `tests.fakes`, `FakeAssertionError`, `clock.now`, `ids.uuid`, `setDispatchInterceptor`; "assert an email was sent", "assert a job was dispatched", "freeze time in a test", "deterministic ids", "tests without Redis", "keep the real cache driver in tests". Typical import `import { mailFake, queueFake } from "@warlock.js/core/tests"`. Skip: HTTP request helpers — the `test-http` topic; fixtures — the `model-factories` topic.'
---

# Warlock — test fakes

In the test environment seven fakes are installed for you: `setupTest()` installs them in every test file once its connectors are up, `startHttpTestServer()` installs them in the shared server, and teardown restores them. Nothing is delivered, pushed to Redis, uploaded to a bucket, and time and ids are deterministic.

| Fake          | Replaces                                                              |
| ------------- | --------------------------------------------------------------------- |
| `mailFake`    | Mail delivery: `sendMail()` / `Mail` sends are captured               |
| `queueFake`   | `@warlock.js/queue` dispatch: jobs are recorded, not pushed           |
| `cacheFake`   | The cache's current driver: a fresh in-memory driver                  |
| `storageFake` | Every storage driver (local, S3, R2, Spaces): a temp directory        |
| `clockFake`   | `clock` from `@warlock.js/core`: frozen at 2026-01-01T00:00:00Z       |
| `idsFake`     | `ids` from `@warlock.js/core`: numbered UUIDs and tokens              |
| `secretsFake` | The `secrets` facade: namespace-aware memory, no OS/environment/files |

## Assert what your code did

```ts
// with: import { cacheFake, mailFake, queueFake, storageFake } from "@warlock.js/core/tests";
//       plus your job (buildReport) and service (requestReportService)
beforeEach(() => {
  mailFake.clear();
  queueFake.clear();
});

it("queues the report, mails the requester and caches the request", async () => {
  await requestReportService({ reportId: "r-1", email: "ada@example.test" });

  mailFake.assertSent({ to: "ada@example.test", subject: /report requested/i });
  mailFake.assertSentCount(1);
  queueFake.assertPushed(buildReport, { reportId: "r-1" });
  queueFake.assertNotPushed("reports.cleanup");
  await cacheFake.assertHas("reports.r-1.status");
  await storageFake.assertMissing("reports/r-1.pdf");
});
```

- **mail** — `assertSent(matcher?)` returns the first match; `assertNotSent`, `assertSentCount(n, matcher?)`, `assertNothingSent()`, `sent(matcher?)`, `clear()`. Matcher: a predicate or `{ to, subject, from, contains }` (`to` matches to/cc/bcc, `subject` a string or RegExp, `contains` the HTML or text body).
- **queue** — `assertPushed(jobOrName, payloadSubset?)`, `assertNotPushed`, `assertPushedCount(n, job?)`, `assertNothingPushed()`, `pushed(job?, matcher?)`. Each record has `id`, `name`, `queue`, `payload`, `options` (`delay`, `priority`, `jobId`) and `pushedAt`. An explicit `jobId` stays idempotent and `job.find(id)` answers from the record. Jobs are not run — call the handler to test it.
- **cache** — `assertHas(key)`, `assertMissing(key)`, `assertStored(key, value)` (deep equality), `driver()`, `clear()`. TTLs, tags, namespaces and locks are the real memory driver's.
- **storage** — `assertExists(path, driver?)`, `assertMissing(path, driver?)`, `files(driver?)`, `root()`. Each configured driver name gets a folder under one temp root, shared with the HTTP test server through `WARLOCK_TEST_STORAGE_ROOT`; the process that created it deletes it.
- **secrets** — async `assertHas(name)`, `assertMissing(name)`, `assertStored(name, value)`, plus `clear()` and `isInstalled()`. Assertion errors never reveal values. See `store-secrets` for examples and explicit memory stores.
- A failed assertion throws `FakeAssertionError`; secret assertions omit values. Other fakes list what was recorded.

## Time and ids

```ts
import { clock, ids } from "@warlock.js/core";
import { clockFake, idsFake } from "@warlock.js/core/tests";
import { expect, it } from "vitest";

it("is deterministic", () => {
  expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");

  clockFake.travel(90_000); // +1m30s
  clockFake.travelTo("2030-05-05T10:00:00Z");

  expect(ids.uuid()).toBe("00000000-0000-4000-8000-000000000001");
  expect(ids.uuid()).toBe(idsFake.uuid(2));
});
```

Only `clock` and `ids` are faked — `Date`, `setTimeout` and drivers keep real time, so nothing stalls. In app code, read time through `clock.now()` / `clock.timestamp()` and make identifiers with `ids.uuid()` / `ids.token(length)` wherever a test needs to control them; outside tests they are the system clock and `node:crypto`.

## Where a fake records

A fake records in the process that runs the code. A request served by the shared `startHttpTestServer()` runs in Vitest's main process, so its mail is captured there, not in your test. Serve it in the worker with `createTestHttpServer()` (the `test-http` topic) and the worker's fakes see it:

```ts
import { createTestHttpServer, mailFake } from "@warlock.js/core/tests";
import { it } from "vitest";

it("mails the requester", async () => {
  const app = await createTestHttpServer({
    loadAppModules: true,
    importModule: (file) => import(file),
  });

  try {
    await app.post("/reports", { reportId: "r-1", email: "ada@example.test" });
    mailFake.assertSent({ to: "ada@example.test" });
  } finally {
    await app.close();
  }
});
```

## Opting out

Precedence: the `fakes` option > `tests.fakes` in `src/config/tests.ts` > all on.

```ts title="src/config/tests.ts"
const testsConfigurations = {
  fakes: { cache: false }, // keep the configured cache driver; `fakes: false` keeps every real driver
};

export default testsConfigurations;
```

```ts title="src/test-setup.ts"
import { setupTest, teardownTest } from "@warlock.js/core/tests";
import { afterAll } from "vitest";

await setupTest({ importModule: (file) => import(file), fakes: { storage: false } });

afterAll(teardownTest);
```

An unknown fake name or a non-boolean value fails setup with the list of known fakes. Without `setupTest()`, call `installTestFakes(selection?)` / `restoreTestFakes()` yourself.

## Gotchas

- **Recorded state lives for the test file.** Call `clear()` in `beforeEach` when tests in one file must not see each other's mails or jobs.
- **Real deliveries in tests need an opt-out.** A test that relied on a real SMTP sink, a Redis cache shared between the HTTP server and the workers, or a real bucket now gets the fake — set that fake to `false`.
- **The queue seam is public.** `setDispatchInterceptor({ dispatch, find? })` from `@warlock.js/queue` replaces the broker for every job in the process; `queueFake` is built on it.

## See also

- The `test-service` topic — `setupTest()` and its lifecycle.
- The `test-http` topic — `createTestHttpServer()` and the HTTP helpers.
- The `model-factories` topic — deterministic fixtures.
