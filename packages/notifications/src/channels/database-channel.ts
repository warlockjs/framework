/**
 * `databaseChannel` — persists notifications via the bound repository.
 *
 * NOT created by the dev directly — `inApp.configure({ model })` builds it
 * and returns it. That way the read side (`inApp.listUnread`, etc.) and the
 * write side (this channel's `send`) share ONE repository instance, which
 * means cache invalidation just works.
 *
 * Route is `{ id: notifiable.id }` — the recipient's id, used to set
 * `recipientId` on the persisted row.
 *
 * The dispatcher has already injected `SendOptions.idempotencyKey` into the
 * payload (when set), so `createFor` receives a payload that includes it.
 * The repo's `filterBy` exposes `idempotencyKey` for dedupe lookups; a
 * unique index in the migration enforces uniqueness at the DB level.
 */
import type { NotificationContract } from "../contracts";
import type { Channel } from "../contracts";
import { defineChannel } from "../dispatch/define-channel";
// Type-only import to avoid a runtime cycle with `in-app/in-app.ts`.
import type { BaseNotificationsRepository } from "../in-app/base-notifications-repository";
import type { DatabasePayload, Id } from "../types";

export function databaseChannel<TModel extends NotificationContract = NotificationContract>(
  repo: BaseNotificationsRepository<TModel>,
): Channel<DatabasePayload> {
  return defineChannel<DatabasePayload>({
    name: "database",
    route: (notifiable) => ({ id: notifiable.id }),
    async send({ payload, route }) {
      const id: Id = typeof route === "object" ? route.id : route;
      await repo.createFor(id, payload);
    },
  });
}
