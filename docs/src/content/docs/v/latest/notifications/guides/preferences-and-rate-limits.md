---
title: "Preferences & rate limits"
description: Two optional pre-send gates — a PreferenceProvider for opt-outs/quiet-hours and a RateLimiter for per-user budgets.
sidebar:
  label: "Preferences & rate limits"
---

Two optional config slots gate the dispatch *before* a channel sends. Both are app-owned — the package reserves the shape and ships no defaults.

## PreferenceProvider — what the user accepts

Returns the subset of requested channels a recipient accepts (mute lists, quiet hours, per-type opt-ins):

```ts title="src/app/notifications/providers/user-preferences.provider.ts"
import type { PreferenceProvider } from "@warlock.js/notifications";

export const userPreferences: PreferenceProvider = {
  resolveChannels(user, type, requested) {
    const muted = (user.get("preferences.muted") ?? {}) as Record<string, string[]>;
    return requested.filter((channel) => !(muted[channel] ?? []).includes(type));
  },
};
```

Wire it: add `preferences: userPreferences` to the config object in `config/notifications.ts`.

A dropped channel fires a `skipped` event with `reason: "preference"`. `SendOptions.force === true` **bypasses** this gate — use it for security/critical sends a user can't mute (password changed, 2FA).

## RateLimiter — how much, how often

Returns `false` to drop a channel for this send. A natural fit for a cache token bucket:

```ts title="src/app/notifications/providers/rate-limit.provider.ts"
import { cache } from "@warlock.js/cache";
import type { RateLimiter } from "@warlock.js/notifications";

export const rateLimit: RateLimiter = {
  async allow(user, channel, type) {
    if (!type.startsWith("marketing.")) return true; // only cap marketing on mail
    const key = `notif.rl.${user.id}.${channel}.${type}`;
    const count = await cache.increment(key, 1);
    if (count === 1) await cache.set(key, 1, { ttl: 3600 });
    return count <= 5; // 5/hour
  },
};
```

Wire it: add `rateLimit` to the config object in `config/notifications.ts`. A dropped channel fires `skipped` with `reason: "rate-limit"`. **`force` does NOT bypass rate limits** — they're a safety valve, not a UX preference.

## Order + interaction

For each (recipient, channel): preferences run first (unless `force`), then the rate limiter. Both gates are silent to the caller — observe drops via the `skipped` event:

```ts
notifications.on("skipped", ({ channel, reason }) =>
  metrics.inc(`notif.${channel}.skipped.${reason}`));
```

> For `.queue()` sends, the rate-limit budget is currently consumed at enqueue time; with the herald worker it moves to delivery time.

## Next

- [Observability](./observability.md) — count drops, sends, failures.
- [Define a notification](./define-notification.md) — `force` per send.
