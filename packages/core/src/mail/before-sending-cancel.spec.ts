import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetMailConfig, setMailMode } from "./config";
import { mailEvents } from "./events";
import { sendMail } from "./send-mail";
import { clearTestMailbox, getTestMailbox } from "./test-mailbox";

describe("global beforeSending cancel", () => {
  const subscriptions: Array<{ unsubscribe: () => void }> = [];

  afterEach(() => {
    subscriptions.splice(0).forEach((subscription) => subscription.unsubscribe());
    clearTestMailbox();
    resetMailConfig();
  });

  const mail = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" };

  it("cancels the send when a global handler returns false", async () => {
    setMailMode("test");
    subscriptions.push(mailEvents.onBeforeSending(() => false));

    const result = await sendMail({ ...mail });

    expect(result.success).toBe(false);
    expect(getTestMailbox()).toHaveLength(0);
  });

  it("cancels the send when an async global handler resolves false", async () => {
    setMailMode("test");
    subscriptions.push(mailEvents.onBeforeSending(async () => false as const));

    const result = await sendMail({ ...mail });

    expect(result.success).toBe(false);
    expect(getTestMailbox()).toHaveLength(0);
  });

  it("cancels the send when a handler for that mail id returns false", async () => {
    setMailMode("test");
    subscriptions.push(mailEvents.onMailBeforeSending("cancel-me", () => false));

    const result = await sendMail({ ...mail, id: "cancel-me" });

    expect(result.success).toBe(false);
  });

  it("still sends when handlers return nothing or true", async () => {
    setMailMode("test");
    const seen = vi.fn();
    subscriptions.push(mailEvents.onBeforeSending(seen));
    subscriptions.push(mailEvents.onBeforeSending((() => true) as any));

    const result = await sendMail({ ...mail });

    expect(seen).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(getTestMailbox()).toHaveLength(1);
  });
});

describe("success and sent handlers", () => {
  const subscriptions: Array<{ unsubscribe: () => void }> = [];

  afterEach(() => {
    subscriptions.splice(0).forEach((subscription) => subscription.unsubscribe());
    clearTestMailbox();
    resetMailConfig();
    vi.restoreAllMocks();
  });

  const mail = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" };

  it("waits for an async success handler before sendMail resolves", async () => {
    setMailMode("test");
    let finished = false;
    subscriptions.push(
      mailEvents.onSuccess(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        finished = true;
      }),
    );

    await sendMail({ ...mail });

    expect(finished).toBe(true);
  });

  it("logs a rejecting success handler and still runs the per-mail one", async () => {
    setMailMode("test");
    const logged = vi.spyOn(log, "error").mockImplementation(() => undefined as never);
    const perMail = vi.fn();
    subscriptions.push(
      mailEvents.onSuccess(async () => {
        throw new Error("audit store down");
      }),
    );
    subscriptions.push(mailEvents.onMailSuccess("logged-mail", perMail));

    const result = await sendMail({ ...mail, id: "logged-mail" });

    expect(result.success).toBe(true);
    expect(perMail).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith(
      "mail",
      "event",
      expect.stringContaining("audit store down"),
    );
  });
});
