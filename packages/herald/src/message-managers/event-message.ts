/**
 * This class is used to be part of the Herald Event Message Manager.
 * It should be used to trigger events to Either RabbitMQ or Kafka through Herald
 *
 * It's highly recommended using it instead of declaring manual channel namd and publishing data
 */
import { GenericObject } from "@mongez/reinforcements";
import { type ObjectValidator } from "@warlock.js/seal";
import { randomUUID } from "crypto";

export abstract class EventMessage<TPayload = Record<string, any>> {
  /**
   * Event Name
   */
  public abstract eventName: string;

  /**
   * Event version
   */
  public version?: number;

  /**
   * Additional metadata (if any)
   */
  public metadata?: Record<string, any>;

  /**
   * Event Message id
   */
  public messageId?: string;

  /**
   * Schema of payload that will be used to determine whether this event should be published
   */
  public schema?: ObjectValidator;

  /**
   * Data that will be sent with the event (Payload)
   */
  public toJSON(): TPayload {
    if (!this.data) {
      throw new Error(`no Data is defined for Event: ${this.eventName}`);
    }

    return this.data as TPayload;
  }

  public constructor(protected data?: TPayload) {}

  /**
   * Serialize the event to be ready for publishing
   */
  public serialize() {
    if (!this.data && !this.toJSON) {
      throw new Error("No data or toJSON method provided");
    }

    const payload = this.toJSON();

    return {
      payload,
      metadata: this.metadata,
      messageId: this.messageId ?? randomUUID(),
      eventName: this.eventName,
      version: this.version,
      occurredAt: new Date(),
      __through: "EventMessage",
    };
  }
}

type EventOptions<T> = {
  /**
   * Shapen the data that will be used
   */
  toJSON?: (data: T) => GenericObject;
  /**
   * Validation schema
   */
  schema?: ObjectValidator;
};

/**
 * A shorthand to define an event without declaring an entire class
 */
export function defineEvent<IncomingData = unknown, OutcomingData = unknown>(
  eventName: string,
  options: EventOptions<IncomingData> = {},
): typeof EventMessage<OutcomingData> {
  return class AnnouncedEvent extends EventMessage<OutcomingData> {
    public eventName = eventName;
    public schema = options.schema;

    public toJSON() {
      if (!options.toJSON) return super.toJSON();

      return options.toJSON(this.data as IncomingData) as OutcomingData;
    }
  };
}
