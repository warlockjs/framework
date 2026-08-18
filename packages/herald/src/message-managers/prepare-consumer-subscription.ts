import type { MessageHandler } from "./../types";
import { EventConsumerClass } from "./types";

export function prepareConsumerSubscription(
  Consumer: EventConsumerClass,
  onError?: (error: unknown, consumerName: string) => void,
) {
  const callback: MessageHandler<any> = async (message, ctx) => {
    const envelope = message.payload;
    let eventPayload = envelope.payload;

    if (envelope.version) {
      if (!Consumer.isAcceptedVersion(Number(envelope.version))) {
        ctx.ack(); // Acknowledge but don't process
        return;
      }
    }

    const consumer = new Consumer();

    if (consumer.schema) {
      const result = await consumer.validate(eventPayload);
      if (!result || result.isValid === false) {
        ctx.nack();
        return;
      }

      eventPayload = result.data;
    }
    try {
      await consumer.handle(eventPayload, {
        payload: eventPayload,
        eventName: Consumer.eventName,
        messageId: message.metadata.messageId!,
        occurredAt: envelope.occurredAt ? new Date(envelope.occurredAt) : undefined,
        metadata: envelope.metadata,
        version: envelope.version,
        message,
      });
      ctx.ack(); // Auto-ack on success?
    } catch (error) {
      // Bounded retry instead of an unconditional requeue: a message that
      // reliably throws (bad payload, a handler bug, a downstream outage)
      // would otherwise be nack+requeued forever, pinning the consumer in a
      // hot loop. `ctx.retry()` caps redelivery and dead-letters/drops (with
      // a loud log) once the cap is hit.
      await ctx.retry();
      if (onError) {
        onError(error, Consumer.eventName);
      }
    }
  };

  return callback;
}
