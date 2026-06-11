/**
 * `@warlock.js/notifications` — root barrel.
 *
 * Layered exports:
 *
 *  - Public types + the `NotificationChannels` registry (`./types`).
 *  - Contracts every consumer + adapter implements (`./contracts`).
 *  - Errors thrown by the dispatcher (`./errors`).
 *  - Runtime config singleton (`./config`).
 *  - Dispatch core (`./dispatch`) — `defineNotification`, `notify`,
 *    `defineChannel`, `notifications.on`.
 *  - Shipped channel factories (`./channels`) — `mailChannel`,
 *    `databaseChannel`.
 *  - In-app store + facade (`./in-app`) — `DatabaseNotification`,
 *    `BaseNotificationsRepository`, `inApp`.
 *  - Migration helper (`./migration`) — `notificationColumns`.
 *
 * Bridges-backed channels (whatsapp / telegram / push / slack) arrive in
 * Phase 2 as additional `./channels/*-channel.ts` files following the same
 * factory + declaration-merge pattern.
 */

// Types + channel registry (declaration-merge target)
export * from "./types";

// Contracts (interfaces)
export * from "./contracts";

// Errors
export * from "./errors";

// Runtime config holder (setNotificationConfig / getNotificationConfig)
export * from "./config";

// Dispatch core (defineNotification, notify, defineChannel, notifications.on)
export * from "./dispatch";

// Shipped channels (mail, database)
export * from "./channels";

// In-app store + facade
export * from "./in-app";

// Migration helper
export * from "./migration";

// Async queue backend (Phase 2) — herald-backed dispatcher + worker
export * from "./queue";
