import { afterEach, describe, expect, it, vi } from "vitest";

// Mock @warlock.js/herald BEFORE importing the package. vi.hoisted gives the
// mock fns stable refs the (hoisted) vi.mock factory + the tests both see.
const { publishMock, subscribeMock, channelMock, heraldMock } = vi.hoisted(() => {
  const publishMock = vi.fn().mockResolvedValue(undefined);
  const subscribeMock = vi.fn().mockResolvedValue(undefined);
  const channelMock = vi.fn(() => ({ publish: publishMock, subscribe: subscribeMock }));
  const heraldMock = vi.fn(() => ({ channel: channelMock }));
  return { publishMock, subscribeMock, channelMock, heraldMock };
});

vi.mock("@warlock.js/herald", () => ({ herald: heraldMock }));

import {
  heraldQueue,
  resetNotificationConfig,
  setNotificationConfig,
  startNotificationsWorker,
  type Channel,
} from "../../../src";

const makeChannel = (name: string, send = vi.fn().mockResolvedValue(undefined)): Channel<any> => ({
  name,
  send,
});

describe("heraldQueue (producer)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("publishes the job to the default channel", async () => {
    const queue = heraldQueue();
    const job = { channel: "mail", route: "x@y.com", payload: { subject: "hi" }, options: {} };

    await queue.dispatch(job);

    expect(channelMock).toHaveBeenCalledWith("notifications.dispatch");
    expect(publishMock).toHaveBeenCalledWith(job);
  });

  it("honors a custom channel name + broker", async () => {
    const queue = heraldQueue({ channel: "notif.q", broker: "analytics" });
    await queue.dispatch({ channel: "mail", route: "x", payload: {}, options: {} });

    expect(heraldMock).toHaveBeenCalledWith("analytics");
    expect(channelMock).toHaveBeenCalledWith("notif.q");
  });
});

describe("startNotificationsWorker (consumer)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetNotificationConfig();
  });

  it("subscribes to the channel and runs the channel.send for each job, then acks", async () => {
    const mailSend = vi.fn().mockResolvedValue(undefined);
    setNotificationConfig({ channels: { mail: makeChannel("mail", mailSend) } as any });

    await startNotificationsWorker();
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    // Grab the handler the worker registered and drive it with a job.
    const handler = subscribeMock.mock.calls[0][0] as (m: any, c: any) => Promise<void>;
    const ack = vi.fn().mockResolvedValue(undefined);

    await handler(
      { payload: { channel: "mail", route: "x@y.com", payload: { subject: "hi" }, options: {} } },
      { ack },
    );

    expect(mailSend).toHaveBeenCalledWith(
      expect.objectContaining({ route: "x@y.com", payload: { subject: "hi" } }),
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("acks + logs (does not throw) when the channel send fails", async () => {
    const mailSend = vi.fn().mockRejectedValue(new Error("smtp down"));
    setNotificationConfig({ channels: { mail: makeChannel("mail", mailSend) } as any });

    await startNotificationsWorker();
    const handler = subscribeMock.mock.calls[0][0] as (m: any, c: any) => Promise<void>;
    const ack = vi.fn().mockResolvedValue(undefined);

    await expect(
      handler({ payload: { channel: "mail", route: "x", payload: {}, options: {} } }, { ack }),
    ).resolves.toBeUndefined();

    expect(ack).toHaveBeenCalledTimes(1); // acked despite the failure (no poison loop)
  });

  it("acks + logs when the job names an unknown channel", async () => {
    setNotificationConfig({ channels: {} });

    await startNotificationsWorker();
    const handler = subscribeMock.mock.calls[0][0] as (m: any, c: any) => Promise<void>;
    const ack = vi.fn().mockResolvedValue(undefined);

    await handler({ payload: { channel: "ghost", route: "x", payload: {}, options: {} } }, { ack });

    expect(ack).toHaveBeenCalledTimes(1);
  });
});
