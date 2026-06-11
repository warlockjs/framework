import type { Id } from "../types";

/**
 * The stored in-app record contract the database channel + `inApp` depend on.
 * Accessors are the STABLE surface; physical columns vary per app and are
 * mapped in the user model's getters + the repository's `filterBy` tuples.
 */
export interface NotificationContract {
  readonly recipientId: Id;
  readonly type: string;
  readonly isRead: boolean;
  readonly readAt: Date | null;
  markRead(): Promise<void>;
}
