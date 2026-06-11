import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notify,
  resetNotificationConfig,
  setNotificationConfig,
  UnresolvableRouteError,
  type Channel,
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
  route?: (n: Notifiable) => any,
): Channel<any> => ({ name, route, send });

describe("notify", () => {
  let mailSend: ReturnType<typeof vi.fn>;
  let databaseSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mailSend = vi.fn().mockResolvedValue(undefined);
    databaseSend = vi.fn().mockResolvedValue(undefined);

    setNotificationConfig({
      channels: {
        mail: makeChannel("mail", mailSend, (n) => n.get("email")),
        database: makeChannel("database", databaseSend, (n) => ({ id: n.id })),
      } as any,
    });
  });

  afterEach(() => {
    resetNotificationConfig();
  });

  it("`notify.<channel>(to, payload)` dispatches to the channel with the resolved route", async () => {
    await notify.mail(makeNotifiable({ email: "x@y.com" }), { subject: "hi", html: "<p>x</p>" });

    expect(mailSend).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { subject: "hi", html: "<p>x</p>" }, route: "x@y.com" }),
    );
  });

  it("accepts a raw route string", async () => {
    await notify.mail("guest@example.com", { subject: "x", html: "<p>x</p>" });
    expect(mailSend).toHaveBeenCalledWith(expect.objectContaining({ route: "guest@example.com" }));
  });

  it("`notify.channel(name).send(...)` resolves at runtime", async () => {
    await notify.channel("mail").send(makeNotifiable({ email: "x@y.com" }), {
      subject: "y",
      html: "<p>y</p>",
    });
    expect(mailSend).toHaveBeenCalledTimes(1);
  });

  it("rejects when the channel is not configured", async () => {
    await expect(notify.channel("nope").send(makeNotifiable(), { x: 1 })).rejects.toThrow(
      /Channel "nope"/,
    );
  });

  it("falls back to `{ id }` when the channel declares NO route resolver", async () => {
    setNotificationConfig({
      channels: { database: makeChannel("database", databaseSend) } as any,
    });

    await notify.database(makeNotifiable({ id: "u42" }), { type: "welcome", title: "Hi!" });

    expect(databaseSend).toHaveBeenCalledWith(expect.objectContaining({ route: { id: "u42" } }));
  });

  it("throws UnresolvableRouteError when a route resolver returns undefined (e.g. no email)", async () => {
    // recipient has no `email`, so the mail resolver returns undefined
    await expect(
      notify.mail(makeNotifiable({ id: "u7" }), { subject: "x", html: "<p>x</p>" }),
    ).rejects.toThrow(UnresolvableRouteError);

    expect(mailSend).not.toHaveBeenCalled();
  });

  it("is NOT an accidental thenable (notify.then is undefined)", () => {
    expect((notify as any).then).toBeUndefined();
    expect((notify as any).catch).toBeUndefined();
    expect((notify as any).finally).toBeUndefined();
  });

  it("auto-detects the notification type from a database payload's `type`", async () => {
    const seen: string[] = [];
    setNotificationConfig({
      channels: { database: makeChannel("database", databaseSend, (n) => ({ id: n.id })) } as any,
      preferences: {
        resolveChannels: (_n, type, req) => {
          seen.push(type);
          return req;
        },
      },
    });

    await notify.database(makeNotifiable(), { type: "welcome", title: "Hi!" });
    expect(seen).toEqual(["welcome"]);
  });

  it("`SendOptions.type` overrides a payload's type for ad-hoc gating", async () => {
    const seen: string[] = [];
    setNotificationConfig({
      channels: { database: makeChannel("database", databaseSend, (n) => ({ id: n.id })) } as any,
      preferences: {
        resolveChannels: (_n, type, req) => {
          seen.push(type);
          return req;
        },
      },
    });

    await notify.database(
      makeNotifiable(),
      { type: "welcome", title: "Hi!" },
      { type: "marketing.weekly" },
    );
    expect(seen).toEqual(["marketing.weekly"]);
  });
});
