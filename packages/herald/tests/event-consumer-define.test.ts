import { v } from "@warlock.js/seal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brokerRegistry } from "../src/communicators";
import { pendingSubscribers } from "../src/decorators/consumable";
import { defineConsumer, EventConsumer } from "../src/message-managers/event-consumer";
import type { ConsumedEventMessage } from "../src/message-managers/types";

/**
 * Build a minimal `ConsumedEventMessage` for driving a consumer's `handle`
 * directly, without a live broker delivery.
 */
function consumedEvent(payload: Record<string, any>): ConsumedEventMessage {
  return {
    payload,
    eventName: "demo",
    messageId: "msg-1",
    message: { metadata: { messageId: "msg-1", timestamp: new Date() }, payload },
  };
}

describe("EventConsumer.validate", () => {
  it("resolves to undefined when the consumer declares no schema", async () => {
    class NoSchema extends EventConsumer {
      public static eventName = "demo";
      public async handle() {}
    }

    await expect(new NoSchema().validate({ anything: true })).resolves.toBeUndefined();
  });

  it("runs the real schema and reports an invalid payload", async () => {
    class Schemad extends EventConsumer<{ qty: number }> {
      public static eventName = "demo";
      public schema = v.object({ qty: v.int() });
      public async handle() {}
    }

    const result = await new Schemad().validate({ qty: "nope" } as never);

    expect(result).toBeDefined();
    expect(result!.isValid).toBe(false);
  });

  it("returns coerced data for a valid payload", async () => {
    class Schemad extends EventConsumer<{ qty: number }> {
      public static eventName = "demo";
      public schema = v.object({ qty: v.int() });
      public async handle() {}
    }

    const result = await new Schemad().validate({ qty: 5 });

    expect(result!.isValid).toBe(true);
    expect(result!.data).toMatchObject({ qty: 5 });
  });
});

describe("defineConsumer", () => {
  afterEach(() => {
    pendingSubscribers.clear();
    brokerRegistry.clear();
  });

  it("produces a consumer class carrying the event name and a consumerId", () => {
    const Consumer = defineConsumer("user.updated", {
      handle: async () => undefined,
    });

    expect(Consumer.eventName).toBe("user.updated");
    expect(typeof Consumer.consumerId).toBe("string");
    expect(Consumer.isAcceptedVersion(1)).toBe(true);
  });

  it("invokes the handle callback with the payload and event", async () => {
    const handle = vi.fn(async () => undefined);

    const Consumer = defineConsumer<{ value: number }>("demo.handle", { handle });

    const instance = new Consumer();
    const event = consumedEvent({ value: 10 });

    await instance.handle({ value: 10 }, event);

    expect(handle).toHaveBeenCalledWith({ value: 10 }, event);
  });

  it("skips handle when the validate callback returns false", async () => {
    const handle = vi.fn(async () => undefined);

    const Consumer = defineConsumer<{ value: number }>("demo.invalid", {
      handle,
      validate: async () => false,
    });

    await new Consumer().handle({ value: 1 }, consumedEvent({ value: 1 }));

    expect(handle).not.toHaveBeenCalled();
  });

  it("skips handle when the validate callback returns an invalid ValidationResult", async () => {
    const handle = vi.fn(async () => undefined);

    const Consumer = defineConsumer<{ value: number }>("demo.invalid-result", {
      handle,
      validate: async () => ({ isValid: false, data: undefined, errors: [] }),
    });

    await new Consumer().handle({ value: 1 }, consumedEvent({ value: 1 }));

    expect(handle).not.toHaveBeenCalled();
  });

  it("runs handle when the validate callback returns a valid ValidationResult", async () => {
    const handle = vi.fn(async () => undefined);

    const Consumer = defineConsumer<{ value: number }>("demo.valid-result", {
      handle,
      validate: async () => ({ isValid: true, data: { value: 1 }, errors: [] }),
    });

    await new Consumer().handle({ value: 1 }, consumedEvent({ value: 1 }));

    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("buffers the defined consumer as a pending subscriber when no broker is registered", () => {
    pendingSubscribers.clear();

    const Consumer = defineConsumer("demo.pending", { handle: async () => undefined });

    const buffered = Array.from(pendingSubscribers).some((entry) => entry.Consumer === Consumer);

    expect(buffered).toBe(true);
  });
});
