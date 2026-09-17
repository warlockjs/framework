/**
 * Integration specs against a REAL Redis (no mocking `@warlock.js/queue`).
 * Point them at one with `QUEUE_REDIS_HOST` / `QUEUE_REDIS_PORT` (default
 * 127.0.0.1:6390) — same convention `@warlock.js/queue`'s own specs use.
 */
import { randomUUID } from "node:crypto";
import {
  bullmqQueue,
  defineNotification,
  resetNotificationConfig,
  setNotificationConfig,
  type Channel,
  type MailPayload,
  type Notifiable,
} from "../../src";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeQueue, setQueueConfig, startWorkers, type QueueConfig } from "@warlock.js/queue";
import { queueNotificationDispatcher } from "@warlock.js/queue/notifications";
import { log } from "@warlock.js/logger";

function testQueueConfig(): QueueConfig {
  return {
    connection: {
      host: process.env.QUEUE_REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.QUEUE_REDIS_PORT ?? 6390),
    },
    prefix: `warlock-notif-test-${randomUUID()}`,
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitFor(predicate: () => boolean, timeout = 10_000): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeout) {
        reject(new Error(`waitFor timed out after ${timeout}ms`));
        return;
      }

      setTimeout(tick, 20);
    };

    tick();
  });
}

const recipient = (id: number, email: string): Notifiable =>
  ({ id, get: (key: string) => (key === "email" ? email : undefined) }) as unknown as Notifiable;

type Delivery = { payload: unknown; route: unknown; at: number };

describe("bullmqQueue (notifications → @warlock.js/queue → channel.send)", () => {
  const deliveries: Delivery[] = [];

  beforeEach(() => {
    deliveries.length = 0;
    setQueueConfig(testQueueConfig());

    const mail: Channel<MailPayload> = {
      name: "mail",
      route: (notifiable) => notifiable.get("email") as string | undefined,
      async send({ payload, route }) {
        deliveries.push({ payload, route, at: Date.now() });
      },
    };

    setNotificationConfig({
      channels: { mail },
      queue: bullmqQueue({ attempts: 2, backoff: 10 }),
    });
  });

  afterEach(async () => {
    await closeQueue({ timeout: 5_000 });
    resetNotificationConfig();
  });

  const welcome = defineNotification<{ name: string }>({
    type: "welcome",
    via: ["mail"],
    mail: ({ name }) => ({ subject: `Hi ${name}`, html: "<p>welcome</p>" }) as MailPayload,
  });

  it("delivers a `.queue()` notification with `delay` only after the delay elapses", async () => {
    await startWorkers();
    const queuedAt = Date.now();
    await welcome.queue(recipient(1, "ada@example.com"), { name: "Ada" }, { delay: "1s" });

    await sleep(500);
    expect(deliveries).toHaveLength(0);

    await waitFor(() => deliveries.length === 1);
    expect(deliveries[0]).toMatchObject({ payload: { subject: "Hi Ada" }, route: "ada@example.com" });
    expect(deliveries[0]!.at - queuedAt).toBeGreaterThanOrEqual(950);
  });
});

describe("queueNotificationDispatcher (deprecated @warlock.js/queue/notifications subpath)", () => {
  const deliveries: Delivery[] = [];
  let warnSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    deliveries.length = 0;
    setQueueConfig(testQueueConfig());

    const mail: Channel<MailPayload> = {
      name: "mail",
      route: (notifiable) => notifiable.get("email") as string | undefined,
      async send({ payload, route }) {
        deliveries.push({ payload, route, at: Date.now() });
      },
    };

    setNotificationConfig({
      channels: { mail },
      queue: queueNotificationDispatcher({ attempts: 2, backoff: 10 }),
    });
  });

  afterEach(async () => {
    await closeQueue({ timeout: 5_000 });
    resetNotificationConfig();
    warnSpy?.mockRestore();
  });

  const welcome = defineNotification<{ name: string }>({
    type: "welcome-deprecated",
    via: ["mail"],
    mail: ({ name }) => ({ subject: `Hi ${name}`, html: "<p>welcome</p>" }) as MailPayload,
  });

  it("still delivers through BullMQ and warns once about the deprecation", async () => {
    await startWorkers();
    await welcome.queue(recipient(2, "bob@example.com"), { name: "Bob" });
    await welcome.queue(recipient(3, "cy@example.com"), { name: "Cy" });

    await waitFor(() => deliveries.length === 2);
    expect(deliveries.map((d) => d.route)).toEqual(["bob@example.com", "cy@example.com"]);

    // `queueNotificationDispatcher` warns once PER PROCESS, not once per
    // dispatcher instance/call — two dispatches above, one warning.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy!.mock.calls[0]!.join(" ")).toContain("bullmqQueue");
  });
});
