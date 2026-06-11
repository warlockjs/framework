import type { ChannelName, Notifiable } from "../types";

/**
 * Per-(recipient, channel, type) rate limit. Return `false` to drop the
 * channel for this send → a `skipped` event fires with reason `"rate-limit"`.
 *
 * `SendOptions.force` does NOT bypass this — rate limits are a safety valve,
 * not a UX preference.
 *
 * Timing note: for synchronous `.send()` the budget is consumed at send time.
 * For `.queue()` it is currently consumed at ENQUEUE time (Phase 1) — when the
 * Phase-2 herald worker lands, delivery-time accounting moves into the worker.
 *
 * App-owned (passed to `setNotificationConfig({ rateLimit })`). The package
 * reserves the slot but ships no default implementation.
 */
export interface RateLimiter {
  allow(
    notifiable: Notifiable,
    channel: ChannelName,
    type: string,
  ): Promise<boolean> | boolean;
}
