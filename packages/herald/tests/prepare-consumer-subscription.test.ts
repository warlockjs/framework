import type { ValidationResult } from "@warlock.js/seal";
import { describe, expect, it, vi } from "vitest";
import { EventConsumer } from "../src/message-managers/event-consumer";
import { prepareConsumerSubscription } from "../src/message-managers/prepare-consumer-subscription";
import type { ConsumedEventMessage, EventConsumerClass } from "../src/message-managers/types";
import type { Message, MessageContext } from "../src/types";

type Payload = { value: number };

/**
 * Build a fake `MessageContext` whose flow-control methods are spies, so a test
 * can assert which acknowledgement decision the dispatcher made.
 */
function createContext(): MessageContext & {
  ack: ReturnType<typeof vi.fn>;
  nack: ReturnType<typeof vi.fn>;
} {
  return {
    ack: vi.fn(async () => undefined),
    nack: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  } as never;
}

/**
 * Wrap a herald envelope (`{ payload, version, ... }`) into the `Message` shape
 * the dispatcher receives, mirroring what the RabbitMQ channel produces.
 */
function createMessage(envelope: Record<string, unknown>): Message<Record<string, unknown>> {
  return {
    metadata: {
      messageId: "metadata-message-id",
      timestamp: new Date(),
    },
    payload: envelope,
  };
}

describe("prepareConsumerSubscription", () => {
  it("invokes the consumer handler and acks on success", async () => {
    const handled: ConsumedEventMessage[] = [];

    class SuccessConsumer extends EventConsumer<Payload> {
      public static eventName = "demo.success";

      public async handle(_payload: Payload, event: ConsumedEventMessage) {
        handled.push(event);
      }
    }

    const callback = prepareConsumerSubscription(SuccessConsumer as unknown as EventConsumerClass);
    const context = createContext();

    await callback(createMessage({ payload: { value: 1 }, version: 1 }), context);

    expect(handled).toHaveLength(1);
    expect(handled[0].eventName).toBe("demo.success");
    expect(handled[0].payload).toEqual({ value: 1 });
    expect(context.ack).toHaveBeenCalledTimes(1);
    expect(context.nack).not.toHaveBeenCalled();
  });

  it("acks without handling when the message version is rejected", async () => {
    const handle = vi.fn();

    class VersionedConsumer extends EventConsumer<Payload> {
      public static eventName = "demo.versioned";
      public static minVersion = 2;

      public async handle() {
        handle();
      }
    }

    const callback = prepareConsumerSubscription(
      VersionedConsumer as unknown as EventConsumerClass,
    );
    const context = createContext();

    await callback(createMessage({ payload: { value: 1 }, version: 1 }), context);

    expect(handle).not.toHaveBeenCalled();
    expect(context.ack).toHaveBeenCalledTimes(1);
  });

  it("nacks and skips the handler when schema validation fails", async () => {
    const handle = vi.fn();

    class ValidatingConsumer extends EventConsumer<Payload> {
      public static eventName = "demo.invalid";
      public schema = {} as never;

      public async validate(): Promise<ValidationResult> {
        return { isValid: false, data: undefined, errors: [] };
      }

      public async handle() {
        handle();
      }
    }

    const callback = prepareConsumerSubscription(
      ValidatingConsumer as unknown as EventConsumerClass,
    );
    const context = createContext();

    await callback(createMessage({ payload: { value: 1 } }), context);

    expect(handle).not.toHaveBeenCalled();
    expect(context.nack).toHaveBeenCalledTimes(1);
    expect(context.ack).not.toHaveBeenCalled();
  });

  it("passes validated (coerced) data to the handler", async () => {
    let received: Payload | undefined;

    class CoercingConsumer extends EventConsumer<Payload> {
      public static eventName = "demo.coerce";
      public schema = {} as never;

      public async validate(): Promise<ValidationResult> {
        return { isValid: true, data: { value: 42 }, errors: [] };
      }

      public async handle(payload: Payload) {
        received = payload;
      }
    }

    const callback = prepareConsumerSubscription(
      CoercingConsumer as unknown as EventConsumerClass,
    );

    await callback(createMessage({ payload: { value: 1 } }), createContext());

    expect(received).toEqual({ value: 42 });
  });

  it("requeues via nack(true) and reports the error when the handler throws", async () => {
    const onError = vi.fn();
    const failure = new Error("handler boom");

    class FailingConsumer extends EventConsumer<Payload> {
      public static eventName = "demo.failing";

      public async handle() {
        throw failure;
      }
    }

    const callback = prepareConsumerSubscription(
      FailingConsumer as unknown as EventConsumerClass,
      onError,
    );
    const context = createContext();

    await callback(createMessage({ payload: { value: 1 } }), context);

    expect(context.nack).toHaveBeenCalledWith(true);
    expect(onError).toHaveBeenCalledWith(failure, "demo.failing");
  });
});
