/**
 * `databaseChannel` — persists notifications via the bound repository.
 *
 * NOT created by the dev directly — `inApp.configure({ model })` builds it
 * and returns it. That way the read side (`inApp.listUnread`, etc.) and the
 * write side (this channel's `send`) share ONE repository instance, which
 * means cache invalidation just works.
 *
 * Route is `{ id: notifiable.id }` — the recipient's id, used to set the
 * recipient column on the persisted row.
 *
 * Multi-tenant: when the model declares a `tenant` column, this channel reads
 * the tenant value off the recipient model (`notifiable.get(tenantColumn)`)
 * and hands it to `createFor`. The recipient model is only present on the
 * synchronous send path; a tenant-scoped store should send (not queue) the
 * database channel so the recipient — and thus the tenant — is in scope.
 *
 * The dispatcher has already injected `SendOptions.idempotencyKey` into the
 * payload (when set), so `createFor` receives a payload that includes it.
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
    async send({ payload, route, notifiable }) {
      const id: Id = typeof route === "object" ? route.id : route;

      const { tenantColumn } = repo;
      const tenantId =
        tenantColumn && notifiable ? (notifiable.get(tenantColumn) as Id) : undefined;

      await repo.createFor(id, payload, tenantId);
    },
  });
}
