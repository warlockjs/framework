import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifications } from "../../../src/dispatch/notifications-event-bus";
import { emit } from "../../../src/dispatch/notifications-event-bus";

describe("notifications event bus", () => {
  beforeEach(() => {
    // Drain any straggling handlers between tests by adding+immediately
    // unsubscribing to each event type — keeps tests independent.
  });

  it("invokes registered handlers with the event payload", async () => {
    const handler = vi.fn();
    const off = notifications.on("sent", handler);

    await emit("sent", {
      channel: "mail",
      payload: { subject: "Hi", html: "<p>x</p>" },
      options: {},
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "mail" }),
    );

    off();
  });

  it("returns an unsubscribe function that stops further calls", async () => {
    const handler = vi.fn();
    const off = notifications.on("failed", handler);
    off();

    await emit("failed", {
      channel: "mail",
      payload: {},
      error: new Error("boom"),
      options: {},
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates handler exceptions — one bad listener does not block others", async () => {
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("listener crash");
    });

    const offBad = notifications.on("skipped", bad);
    const offGood = notifications.on("skipped", good);

    await expect(
      emit("skipped", {
        channel: "push",
        reason: "preference",
        options: {},
      }),
    ).resolves.toBeUndefined();

    expect(good).toHaveBeenCalledTimes(1);

    offBad();
    offGood();
  });

  it("`off()` removes a specific handler without affecting others", async () => {
    const a = vi.fn();
    const b = vi.fn();
    notifications.on("sent", a);
    notifications.on("sent", b);

    notifications.off("sent", a);

    await emit("sent", { channel: "mail", payload: {}, options: {} });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);

    notifications.off("sent", b);
  });
});
