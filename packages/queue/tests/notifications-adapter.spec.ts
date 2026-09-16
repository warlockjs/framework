import {
  defineNotification,
  resetNotificationConfig,
  setNotificationConfig,
  type Channel,
  type MailPayload,
  type Notifiable,
} from "@warlock.js/notifications";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeQueue, failedJobs, setQueueConfig, startWorkers } from "../src";
import { queueNotificationDispatcher } from "../src/notifications";
import { sleep, testQueueConfig, waitFor } from "./test-redis";

type Delivery = { payload: unknown; route: unknown; at: number };

describe("queueNotificationDispatcher (notifications → BullMQ → channel.send)", () => {
  const deliveries: Delivery[] = [];
  let failNext = 0;

  beforeEach(() => {
    deliveries.length = 0;
    failNext = 0;
    setQueueConfig(testQueueConfig());

    const mail: Channel<MailPayload> = {
      name: "mail",
      route: (notifiable) => notifiable.get("email") as string | undefined,
      async send({ payload, route }) {
        if (failNext > 0) {
          failNext--;
          throw new Error("provider down");
        }

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
  });

  const recipient = (id: number, email: string): Notifiable =>
    ({ id, get: (key: string) => (key === "email" ? email : undefined) }) as unknown as Notifiable;

  const welcome = defineNotification<{ name: string }>({
    type: "welcome",
    via: ["mail"],
    mail: ({ name }) => ({ subject: `Hi ${name}`, html: "<p>welcome</p>" }) as MailPayload,
  });

  it("delivers a queued notification through a BullMQ worker", async () => {
    await startWorkers();
    await welcome.queue(recipient(1, "ada@example.com"), { name: "Ada" });

    await waitFor(() => deliveries.length === 1);
    expect(deliveries[0]).toMatchObject({ payload: { subject: "Hi Ada" }, route: "ada@example.com" });
  });

  it("retries a failed channel.send per the dispatcher's attempts", async () => {
    failNext = 1;
    await startWorkers();
    await welcome.queue(recipient(2, "bob@example.com"), { name: "Bob" });

    await waitFor(() => deliveries.length === 1);
    expect(deliveries[0]!.route).toBe("bob@example.com");
  });

  it("honours SendOptions.delay (number = seconds, or a duration string)", async () => {
    await startWorkers();
    const queuedAt = Date.now();
    await welcome.queue(recipient(3, "cy@example.com"), { name: "Cy" }, { delay: "1s" });

    await sleep(500);
    expect(deliveries).toHaveLength(0);

    await waitFor(() => deliveries.length === 1);
    expect(deliveries[0]!.at - queuedAt).toBeGreaterThanOrEqual(950);
  });

  it("fails without retrying when the channel is not configured in the worker", async () => {
    await startWorkers();
    await queueNotificationDispatcher({ attempts: 3, backoff: 10 }).dispatch({
      channel: "pigeon",
      route: "x",
      payload: {},
      options: {},
    });

    let failed = await failedJobs();
    const deadline = Date.now() + 10_000;
    while (failed.length === 0 && Date.now() < deadline) {
      await sleep(50);
      failed = await failedJobs();
    }

    await sleep(300);
    expect((await failedJobs())[0]).toMatchObject({ attemptsMade: 1 });
    expect(failed[0]!.failedReason).toContain("pigeon");
  });
});
