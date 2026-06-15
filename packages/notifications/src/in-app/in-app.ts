/**
 * `inApp` — app-facing facade for the in-app/database channel.
 *
 * `inApp.configure({ model | repository })` binds the in-app store AND
 * returns the `database` channel — so the read side and the dispatched
 * write side share ONE repository instance.
 *   • `{ model: Notification }`  — 90% case; default repo built internally.
 *   • `{ repository: myRepo }`   — 10% case; custom column mapping / extras.
 *
 * No zero-arg form: the package ships no concrete model/table (thin eject),
 * so the dev MUST tell us which model to use.
 *
 * Every read + mutation is RECIPIENT-SCOPED by construction — `markAsRead(user,
 * id)` cannot flip a row belonging to a different recipient even if handed a
 * foreign id (the recipient id is forced into the filter → 0 rows match).
 *
 * @example
 *   // src/config/notifications.ts:
 *   inApp.configure({ model: Notification }),
 *
 *   // anywhere:
 *   const unread = await inApp.listUnread(user);
 *   const badge  = await inApp.countUnread(user);
 *   const one    = await inApp.find(user, "ntf_123");
 *   await inApp.markAsRead(user, "ntf_123");
 *   await inApp.markAsRead(user);            // mark ALL unread
 *   await inApp.dismiss(user, "ntf_123");    // delete one
 *   await inApp.dismiss(user);               // clear all for this recipient
 */
import type { TypedRepositoryOptionsWithPages } from "@warlock.js/core";
import { databaseChannel } from "../channels/database-channel";
import type { Channel } from "../contracts";
import type { DatabasePayload, Id, Notifiable } from "../types";
import {
  BaseNotificationsRepository,
  type NotificationModelClass,
  type NotificationsFilter,
} from "./base-notifications-repository";

/**
 * List options for the read methods — the repository's paginated options
 * (`page` / `limit` / `orderBy` / filter keys). `recipientId` is always forced
 * from the recipient argument, so passing it here has no effect.
 */
export type NotificationsListOptions = TypedRepositoryOptionsWithPages<NotificationsFilter>;

/**
 * Configure options — discriminated so `model` and `repository` are mutually
 * exclusive at the type level. Future knobs (cache / realtime / naming) slot
 * in here without breaking the signature.
 */
export type ConfigureOptions =
  | { model: NotificationModelClass; repository?: never }
  | { repository: BaseNotificationsRepository; model?: never };

const idOf = (recipient: Notifiable | Id): Id =>
  typeof recipient === "object" ? recipient.id : recipient;

class InApp {
  private repo?: BaseNotificationsRepository;

  /**
   * Bind the in-app store AND return the `database` channel. Called once
   * from `config/notifications.ts`. Subsequent calls REPLACE the binding.
   */
  public configure(options: ConfigureOptions): Channel<DatabasePayload> {
    this.repo =
      "repository" in options && options.repository
        ? options.repository
        : new BaseNotificationsRepository(options.model);
    return databaseChannel(this.repo);
  }

  private get repository(): BaseNotificationsRepository {
    if (!this.repo) {
      throw new Error(
        "In-app notifications not configured — add " +
          "`database: inApp.configure({ model: Notification })` to config/notifications.ts",
      );
    }
    return this.repo;
  }

  /** General list — scoped to recipient; pass `options` for paging + filters. */
  public list(recipient: Notifiable | Id, options?: NotificationsListOptions) {
    return this.repository.list({ ...options, recipientId: idOf(recipient) });
  }

  /** Unread-only list — common case for badges + dashboards. */
  public listUnread(recipient: Notifiable | Id, options?: NotificationsListOptions) {
    return this.repository.list({ ...options, recipientId: idOf(recipient), unread: true });
  }

  /**
   * Cached unread count — backs the badge. Auto-invalidated by the repo's
   * model create/update events (`RepositoryManager.registerEvents`).
   */
  public countUnread(recipient: Notifiable | Id) {
    return this.repository.countCached({ recipientId: idOf(recipient), unread: true });
  }

  /** Find one notification for a recipient — for a detail view. */
  public find(recipient: Notifiable | Id, id: Id) {
    return this.repository.findFor(idOf(recipient), id);
  }

  /** Mark read — `id` omitted = all unread for this recipient. */
  public markAsRead(recipient: Notifiable | Id, id?: Id) {
    return this.repository.markRead(idOf(recipient), id);
  }

  /** Mark unread — same recipient-scoping. */
  public markAsUnread(recipient: Notifiable | Id, id?: Id) {
    return this.repository.markUnread(idOf(recipient), id);
  }

  /** Delete/dismiss — `id` omitted = clear all for this recipient. */
  public dismiss(recipient: Notifiable | Id, id?: Id) {
    return this.repository.deleteFor(idOf(recipient), id);
  }
}

/** Single in-app facade — bound at boot via `inApp.configure(...)`. */
export const inApp = new InApp();
