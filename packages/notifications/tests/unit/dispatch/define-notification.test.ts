import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineNotification,
  MissingRendererError,
  NotificationDeliveryError,
  notifications,
  resetNotificationConfig,
  setNotificationConfig,
  type Channel,
  type MailPayload,
  type Notifiable,
} from "../../../src";

const makeNotifiable = (overrides: Record<string, any> = {}): Notifiable =>
  ({
    id: overrides.id ?? "u1",
    get: (key: string) => overrides[key],
  }) as unknown as Notifiable;

const makeChannel = (
  name: string,
  send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
): Channel<any> => ({ name, send });

describe("defineNotification", () => {
  let mailSend: ReturnType<typeof vi.fn>;
  let databaseSend: ReturnType<typeof vi.fn>;

  const configure = (extra: Record<string, unknown> = {}) =>
    setNotificationConfig({
      channels: {
        mail: makeChannel("mail", mailSend),
        database: makeChannel("database", databaseSend),
      } as any,
      ...extra,
    });

  beforeEach(() => {
    mailSend = vi.fn().mockResolvedValue(undefined);
    databaseSend = vi.fn().mockResolvedValue(undefined);
    configure();
  });

  afterEach(() => {
    resetNotificationConfig();
  });

  it("dispatches to every channel in a static `via`", async () => {
    const welcome = defineNotification<{ name: string }>({
      type: "welcome",
      via: ["mail", "database"],
      mail: ({ name }) => ({ subject: `Hi ${name}`, html: "<p>x</p>" }) as MailPayload,
      database: ({ name }) => ({ title: `Hi ${name}` }),
    });

    await welcome.send(makeNotifiable(), { name: "Hasan" });

    expect(mailSend).toHaveBeenCalledTimes(1);
    expect(databaseSend).toHaveBeenCalledTimes(1);
  });

  it("THROWS at definition time when a static `via` channel has no renderer", () => {
    expect(() =>
      defineNotification<{}>({
        type: "broken",
        via: ["mail", "database"],
        mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
        // database renderer intentionally missing
      }),
    ).toThrow(MissingRendererError);
  });

  it("uses the dynamic `via(data, to)` callback", async () => {
    const conditional = defineNotification<{ urgent: boolean }>({
      type: "conditional",
      via: (data) => (data.urgent ? ["mail", "database"] : ["database"]),
      mail: () => ({ subject: "!", html: "<p>!</p>" }) as MailPayload,
      database: () => ({ title: "ping" }),
    });

    await conditional.send(makeNotifiable(), { urgent: false });
    expect(mailSend).not.toHaveBeenCalled();

    await conditional.send(makeNotifiable(), { urgent: true });
    expect(mailSend).toHaveBeenCalledTimes(1);
  });

  it("`only(...)` restricts dispatch to the named channels", async () => {
    const both = defineNotification<{}>({
      type: "both",
      via: ["mail", "database"],
      mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
      database: () => ({ title: "x" }),
    });

    await both.only("mail").send(makeNotifiable(), {});

    expect(mailSend).toHaveBeenCalledTimes(1);
    expect(databaseSend).not.toHaveBeenCalled();
  });

  it("defaults the database payload's `type` from `def.type`", async () => {
    const orderShipped = defineNotification<{}>({
      type: "order.shipped",
      via: ["database"],
      database: () => ({ title: "shipped" }),
    });

    await orderShipped.send(makeNotifiable(), {});

    expect(databaseSend).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ title: "shipped", type: "order.shipped" }),
      }),
    );
  });

  it("fans out to multiple recipients", async () => {
    const note = defineNotification<{}>({
      type: "note",
      via: ["database"],
      database: () => ({ title: "x" }),
    });

    await note.send([makeNotifiable({ id: "u1" }), makeNotifiable({ id: "u2" })], {});

    expect(databaseSend).toHaveBeenCalledTimes(2);
  });

  it("ISOLATES transport failures (mail fails, database still runs, send resolves)", async () => {
    mailSend.mockRejectedValueOnce(new Error("smtp down"));
    const failed = vi.fn();
    const off = notifications.on("failed", failed);

    const note = defineNotification<{}>({
      type: "isolated",
      via: ["mail", "database"],
      mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
      database: () => ({ title: "x" }),
    });

    await expect(note.send(makeNotifiable(), {})).resolves.toBeDefined();

    expect(databaseSend).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ channel: "mail" }));

    off();
  });

  describe("send result", () => {
    const mailAndDatabase = () =>
      defineNotification<{}>({
        type: "result",
        via: ["mail", "database"],
        mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
        database: () => ({ title: "x" }),
      });

    it("resolves with one entry per channel, carrying the transport error", async () => {
      const error = new Error("smtp down");
      mailSend.mockRejectedValueOnce(error);
      const to = makeNotifiable();

      const result = await mailAndDatabase().send(to, {});

      expect(result.delivered).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.allFailed).toBe(false);
      expect(result.results).toEqual([
        { channel: "mail", notifiable: to, status: "failed", error },
        { channel: "database", notifiable: to, status: "sent" },
      ]);
    });

    it("reports queued dispatches as queued", async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      configure({ queue: { dispatch } });

      const result = await mailAndDatabase().queue(makeNotifiable(), {});

      expect(result.results.map((r) => r.status)).toEqual(["queued", "queued"]);
      expect(result.delivered).toBe(2);
    });

    it("reports preference-skipped channels as skipped", async () => {
      configure({
        preferences: {
          resolveChannels: (_n: unknown, _t: unknown, req: string[]) =>
            req.filter((c) => c !== "mail"),
        },
      });

      const result = await mailAndDatabase().send(makeNotifiable(), {});

      expect(result.skipped).toBe(1);
      expect(result.results.find((r) => r.channel === "mail")?.status).toBe("skipped");
      expect(result.allFailed).toBe(false);
    });

    it("reports a renderer that throws as a failed entry and still runs the other channels", async () => {
      const error = new Error("template missing");
      const notification = defineNotification<{}>({
        type: "render-fails",
        via: ["mail", "database"],
        mail: () => {
          throw error;
        },
        database: () => ({ title: "x" }),
      });
      const to = makeNotifiable();

      const result = await notification.send(to, {});

      expect(result.results).toEqual([
        { channel: "mail", notifiable: to, status: "failed", error },
        { channel: "database", notifiable: to, status: "sent" },
      ]);
      expect(mailSend).not.toHaveBeenCalled();
      await expect(notification.send(to, {}, { throwOnFailure: "any" })).rejects.toBeInstanceOf(
        NotificationDeliveryError,
      );
    });

    it('throwOnFailure: "all" rejects only when every channel failed', async () => {
      mailSend.mockRejectedValueOnce(new Error("smtp down"));
      await expect(
        mailAndDatabase().send(makeNotifiable(), {}, { throwOnFailure: "all" }),
      ).resolves.toMatchObject({ failed: 1 });

      mailSend.mockRejectedValueOnce(new Error("smtp down"));
      databaseSend.mockRejectedValueOnce(new Error("db down"));
      const rejected = mailAndDatabase().send(makeNotifiable(), {}, { throwOnFailure: "all" });

      await expect(rejected).rejects.toBeInstanceOf(NotificationDeliveryError);
      await expect(rejected).rejects.toMatchObject({ result: { allFailed: true } });
    });

    it('throwOnFailure: "any" rejects when one channel failed', async () => {
      mailSend.mockRejectedValueOnce(new Error("smtp down"));

      await expect(
        mailAndDatabase().send(makeNotifiable(), {}, { throwOnFailure: "any" }),
      ).rejects.toBeInstanceOf(NotificationDeliveryError);
      expect(databaseSend).toHaveBeenCalledTimes(1); // siblings still ran
    });

    it("throwOnFailure with a channel name rejects only for that channel", async () => {
      databaseSend.mockRejectedValueOnce(new Error("db down"));
      await expect(
        mailAndDatabase().send(makeNotifiable(), {}, { throwOnFailure: "mail" }),
      ).resolves.toMatchObject({ failed: 1 });

      mailSend.mockRejectedValueOnce(new Error("smtp down"));
      await expect(
        mailAndDatabase().send(makeNotifiable(), {}, { throwOnFailure: ["mail"] }),
      ).rejects.toThrow(/failed on: mail/);
    });
  });

  it("PreferenceProvider drops channels → `skipped` event", async () => {
    configure({
      preferences: { resolveChannels: (_n, _t, req) => req.filter((c) => c !== "mail") },
    });

    const skipped = vi.fn();
    const off = notifications.on("skipped", skipped);

    const note = defineNotification<{}>({
      type: "comment.mentioned",
      via: ["mail", "database"],
      mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
      database: () => ({ title: "x" }),
    });

    await note.send(makeNotifiable(), {});

    expect(mailSend).not.toHaveBeenCalled();
    expect(databaseSend).toHaveBeenCalledTimes(1);
    expect(skipped).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "mail", reason: "preference" }),
    );

    off();
  });

  it("`force: true` bypasses PreferenceProvider", async () => {
    configure({ preferences: { resolveChannels: () => [] } });

    const note = defineNotification<{}>({
      type: "security.password_changed",
      via: ["mail", "database"],
      mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
      database: () => ({ title: "x" }),
    });

    await note.send(makeNotifiable(), {}, { force: true });

    expect(mailSend).toHaveBeenCalledTimes(1);
    expect(databaseSend).toHaveBeenCalledTimes(1);
  });

  it("RateLimiter drops via `skipped` with reason `rate-limit`; `force` does NOT bypass it", async () => {
    configure({ rateLimit: { allow: (_n, channel) => channel !== "mail" } });

    const skipped = vi.fn();
    const off = notifications.on("skipped", skipped);

    const note = defineNotification<{}>({
      type: "marketing.weekly",
      via: ["mail", "database"],
      mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
      database: () => ({ title: "x" }),
    });

    await note.send(makeNotifiable(), {}, { force: true });

    expect(mailSend).not.toHaveBeenCalled();
    expect(databaseSend).toHaveBeenCalledTimes(1);
    expect(skipped).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "mail", reason: "rate-limit" }),
    );

    off();
  });

  it("injects `idempotencyKey` into the database payload", async () => {
    const note = defineNotification<{}>({
      type: "x",
      via: ["database"],
      database: () => ({ title: "x" }),
    });

    await note.send(makeNotifiable(), {}, { idempotencyKey: "k123" });

    expect(databaseSend).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ idempotencyKey: "k123" }),
      }),
    );
  });

  it("`queue` REJECTS when no queue dispatcher is configured (config error surfaces)", async () => {
    const note = defineNotification<{}>({
      type: "x",
      via: ["mail"],
      mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
    });

    await expect(note.queue(makeNotifiable(), {})).rejects.toThrow(/queue dispatcher/);
  });

  it("`queue` dispatches to the configured queue dispatcher (not the channel)", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    configure({ queue: { dispatch } });

    const note = defineNotification<{}>({
      type: "x",
      via: ["mail"],
      mail: () => ({ subject: "x", html: "<p>x</p>" }) as MailPayload,
    });

    await note.queue(makeNotifiable(), {}, { delay: "10m" });

    expect(mailSend).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "mail",
        options: expect.objectContaining({ delay: "10m" }),
      }),
    );
  });
});
