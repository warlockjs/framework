/**
 * Recipient identity for the in-app store. A recipient is keyed by
 * `(type, id)`: the same id under two identity types is two recipients.
 */
import type { Id, Notifiable, RecipientRef } from "../types";

/** What the read and mutation methods accept for "who": a model, a typed ref, or a bare id. */
export type RecipientInput = Notifiable | RecipientRef | Id;

/**
 * The identity type of a recipient model. Auth models name it with `userType`
 * (the same value the auth config and token payloads use); any other model
 * falls back to its table name.
 */
export function recipientTypeOf(notifiable: Notifiable): string {
  const userType = (notifiable as { userType?: unknown }).userType;

  if (typeof userType === "string" && userType) {
    return userType;
  }

  return (notifiable.constructor as unknown as { table: string }).table;
}

/** Normalize any accepted recipient form to `{ id, type? }` (`type` absent for bare ids). */
export function toRecipientRef(recipient: RecipientInput): { id: Id; type?: string } {
  if (typeof recipient !== "object") {
    return { id: recipient };
  }

  if ("get" in recipient && typeof recipient.get === "function") {
    return { id: (recipient as Notifiable).id, type: recipientTypeOf(recipient as Notifiable) };
  }

  return { id: (recipient as RecipientRef).id, type: (recipient as RecipientRef).type };
}
