import config from "@mongez/config";
import { cache } from "@warlock.js/cache";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { getMailMode } from "../../mail/config";
import { sendMail } from "../../mail/send-mail";
import { storage } from "../../storage";
import { clock } from "../../utils/clock";
import { ids } from "../../utils/ids";
import { cacheFake } from "./cache-fake";
import { DEFAULT_FAKE_NOW, clockFake } from "./clock-fake";
import { FakeAssertionError } from "./fake-assertion-error";
import { idsFake } from "./ids-fake";
import { mailFake } from "./mail-fake";
import { queueFake } from "./queue-fake";
import { TEST_STORAGE_ROOT_ENV_KEY, storageFake } from "./storage-fake";
import {
  installTestFakes,
  installedTestFakes,
  resolveTestFakes,
  restoreTestFakes,
} from "./test-fakes";

afterEach(async () => {
  await restoreTestFakes();
  mailFake.restore();
  queueFake.restore();
  await cacheFake.restore();
  await storageFake.restore();
  clockFake.restore();
  idsFake.restore();
  config.set("tests", undefined);
});

/** The slot `@warlock.js/queue` reads; see its dispatch-interceptor module. */
type Interceptor = {
  dispatch(job: {
    name: string;
    queue: string;
    payload: unknown;
    options: Record<string, unknown>;
  }): {
    id: string;
  };
  find(job: { name: string; id: string }): unknown;
};

function queueSlot(): Interceptor | undefined {
  return (globalThis as Record<symbol, Interceptor | undefined>)[
    Symbol.for("warlock.queue.dispatchInterceptor")
  ];
}

describe("mailFake", () => {
  it("captures sendMail() and asserts on recipient, subject and body", async () => {
    mailFake.install();

    await sendMail({ to: "ada@example.test", subject: "Welcome, Ada", html: "<p>Hello Ada</p>" });

    expect(getMailMode()).toBe("test");
    expect(
      mailFake.assertSent({ to: "ada@example.test", subject: /welcome/i }).options.subject,
    ).toBe("Welcome, Ada");
    mailFake.assertSent({ contains: "Hello Ada" });
    mailFake.assertSentCount(1);
    mailFake.assertNotSent({ to: "bob@example.test" });
  });

  it("fails with what was actually sent", async () => {
    mailFake.install();

    await sendMail({ to: "ada@example.test", subject: "Receipt", html: "x" });

    expect(() => mailFake.assertSent({ subject: "Welcome" })).toThrow(FakeAssertionError);
    expect(() => mailFake.assertSent({ subject: "Welcome" })).toThrow(
      'to ada@example.test — "Receipt"',
    );
    expect(() => mailFake.assertNothingSent()).toThrow("1 entry was sent");
  });

  it("restores the mode derived from the environment", () => {
    const before = getMailMode();

    mailFake.install();
    mailFake.restore();

    expect(getMailMode()).toBe(before);
  });
});

describe("queueFake", () => {
  const sendInvoice = { name: "invoices.send" };

  it("records dispatches through the queue package's interceptor slot", async () => {
    queueFake.install();

    const slot = queueSlot();

    expect(slot).toBeDefined();

    const first = slot?.dispatch({
      name: "invoices.send",
      queue: "default",
      payload: { invoiceId: "42", total: 10 },
      options: { delay: "10m" },
    });

    expect(first?.id).toBe("fake-1");
    expect(queueFake.assertPushed(sendInvoice, { invoiceId: "42" }).options).toEqual({
      delay: "10m",
    });
    queueFake.assertPushedCount(1, "invoices.send");
    queueFake.assertNotPushed("emails.send");
    expect(() => queueFake.assertPushed(sendInvoice, { invoiceId: "7" })).toThrow(
      'invoices.send on "default" with {"invoiceId":"42","total":10}',
    );
  });

  it("keeps an explicit jobId idempotent and answers find()", () => {
    queueFake.install();

    const slot = queueSlot();

    slot?.dispatch({ name: "a", queue: "q", payload: 1, options: { jobId: "once" } });
    slot?.dispatch({ name: "a", queue: "q", payload: 2, options: { jobId: "once" } });

    queueFake.assertPushedCount(1);
    expect(slot?.find({ name: "a", id: "once" })).toMatchObject({ state: "waiting", payload: 1 });
  });

  it("removes itself on restore", () => {
    queueFake.install();
    queueFake.restore();

    expect(queueSlot()).toBeUndefined();
  });
});

describe("cacheFake", () => {
  it("swaps in a fresh memory driver and restores the previous one", async () => {
    const before = cache.currentDriver;

    await cacheFake.install();
    await cache.set("stats.dashboard", { users: 3 });

    expect(cache.currentDriver).toBe(cacheFake.driver());
    await cacheFake.assertHas("stats.dashboard");
    await cacheFake.assertStored("stats.dashboard", { users: 3 });
    await cacheFake.assertMissing("stats.other");
    await expect(cacheFake.assertStored("stats.dashboard", { users: 4 })).rejects.toThrow(
      'it holds {"users":3}',
    );

    await cacheFake.restore();

    expect(cache.currentDriver).toBe(before);
  });
});

describe("storageFake", () => {
  it("points the default driver at a temp root, shares it through the env, and deletes it on restore", async () => {
    await storageFake.install();

    const root = storageFake.root();

    expect(process.env[TEST_STORAGE_ROOT_ENV_KEY]).toBe(root);

    await storage.put(Buffer.from("hello"), "notes/hello.txt");

    await storageFake.assertExists("notes/hello.txt");
    await storageFake.assertMissing("notes/other.txt");
    expect(storageFake.files("local")).toEqual(["notes/hello.txt"]);

    await storageFake.restore();

    expect(existsSync(root)).toBe(false);
    expect(process.env[TEST_STORAGE_ROOT_ENV_KEY]).toBeUndefined();
  });
});

describe("clockFake and idsFake", () => {
  it("freezes clock at a fixed instant and only moves it when told", () => {
    clockFake.install();

    expect(clock.timestamp()).toBe(DEFAULT_FAKE_NOW);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");

    clockFake.travel(90_000);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:01:30.000Z");

    clockFake.travelTo("2030-05-05T10:00:00Z");
    expect(clock.now().toISOString()).toBe("2030-05-05T10:00:00.000Z");

    clockFake.restore();
    expect(Math.abs(clock.timestamp() - Date.now())).toBeLessThan(1000);
  });

  it("numbers ids deterministically", () => {
    idsFake.install();

    expect(ids.uuid()).toBe("00000000-0000-4000-8000-000000000001");
    expect(ids.uuid()).toBe(idsFake.uuid(2));
    expect(ids.token(12)).toBe("token0001tok");

    idsFake.restore();

    expect(ids.uuid()).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.token()).toHaveLength(32);
  });
});

describe("installTestFakes", () => {
  it("installs every fake by default and restores them all", async () => {
    expect(await installTestFakes()).toEqual([
      "mail",
      "queue",
      "cache",
      "storage",
      "clock",
      "ids",
      "secrets",
    ]);
    expect(queueSlot()).toBeDefined();

    await restoreTestFakes();

    expect(installedTestFakes()).toEqual([]);
    expect(queueSlot()).toBeUndefined();
  });

  it("reads tests.fakes from config, and an explicit selection wins over it", () => {
    config.set("tests", { fakes: { cache: false, storage: false } });

    expect(resolveTestFakes()).toEqual(["mail", "queue", "clock", "ids", "secrets"]);
    expect(resolveTestFakes(true)).toHaveLength(7);
    expect(resolveTestFakes(false)).toEqual([]);

    config.set("tests", { fakes: false });

    expect(resolveTestFakes()).toEqual([]);
  });

  it("rejects an unknown fake name or a non-boolean flag", () => {
    config.set("tests", { fakes: { mailer: false } });

    expect(() => resolveTestFakes()).toThrow('tests.fakes has an unknown fake "mailer"');
    expect(() => resolveTestFakes({ cache: "no" as unknown as boolean })).toThrow(
      "fakes.cache must be true or false",
    );
  });
});
