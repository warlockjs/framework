import { describe, expect, it } from "vitest";
import { defineEvent, EventMessage } from "../src/message-managers/event-message";

type UserPayload = { id: number; name: string };

class UserCreatedEvent extends EventMessage<UserPayload> {
  public eventName = "user.created";
}

describe("EventMessage", () => {
  it("serializes payload, eventName, and an occurredAt timestamp", () => {
    const event = new UserCreatedEvent({ id: 1, name: "Ada" });

    const envelope = event.serialize();

    expect(envelope.payload).toEqual({ id: 1, name: "Ada" });
    expect(envelope.eventName).toBe("user.created");
    expect(envelope.occurredAt).toBeInstanceOf(Date);
    expect(envelope.__through).toBe("EventMessage");
  });

  it("generates a messageId when none is set", () => {
    const event = new UserCreatedEvent({ id: 1, name: "Ada" });

    const envelope = event.serialize();

    expect(typeof envelope.messageId).toBe("string");
    expect(envelope.messageId.length).toBeGreaterThan(0);
  });

  it("preserves an explicit messageId and version", () => {
    const event = new UserCreatedEvent({ id: 1, name: "Ada" });
    event.messageId = "fixed-id";
    event.version = 3;

    const envelope = event.serialize();

    expect(envelope.messageId).toBe("fixed-id");
    expect(envelope.version).toBe(3);
  });

  it("carries metadata through serialization", () => {
    const event = new UserCreatedEvent({ id: 1, name: "Ada" });
    event.metadata = { tenantId: "42" };

    const envelope = event.serialize();

    expect(envelope.metadata).toEqual({ tenantId: "42" });
  });

  it("throws when serializing with no data", () => {
    const event = new UserCreatedEvent();

    expect(() => event.serialize()).toThrowError(/no Data is defined for Event: user.created/);
  });
});

describe("defineEvent", () => {
  it("creates a publishable event class with the given name", () => {
    const OrderPlaced = defineEvent<{ orderId: number }>("order.placed");

    const event = new OrderPlaced({ orderId: 99 });

    expect(event.eventName).toBe("order.placed");
    expect(event.serialize().payload).toEqual({ orderId: 99 });
  });

  it("transforms input via the toJSON projector", () => {
    const UserCreated = defineEvent<UserPayload, { id: number }>("user.created", {
      toJSON: (user) => ({ id: user.id }),
    });

    const event = new UserCreated({ id: 7, name: "Grace" });

    expect(event.serialize().payload).toEqual({ id: 7 });
  });

  it("falls back to the raw data when no toJSON is provided", () => {
    const Raw = defineEvent<{ value: string }>("raw.event");

    const event = new Raw({ value: "hello" });

    expect(event.toJSON()).toEqual({ value: "hello" });
  });
});
