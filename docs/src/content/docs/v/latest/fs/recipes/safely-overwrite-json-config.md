---
title: "Safely overwrite a JSON config"
description: Read a JSON config, mutate it, write it back atomically — without losing data if the process crashes mid-write or another reader picks it up in flight.
sidebar:
  order: 1
  label: "Safely overwrite a JSON config"
---

The pattern: a config file that other tools watch (a dev server, a
linter, your own application's hot-reload). You need to read it, change a
field, write it back — and you don't want a half-written file to ever be
observable.

## The recipe

```ts
import { getJsonFileAsync, atomicWriteJsonAsync, fileExistsAsync } from "@warlock.js/fs";

type Config = {
  apiUrl: string;
  features: Record<string, boolean>;
  updatedAt: string;
};

async function setFeature(name: string, enabled: boolean) {
  // Read current state — fall back to defaults if the file doesn't exist yet.
  const current: Config = (await fileExistsAsync("./config.json"))
    ? await getJsonFileAsync<Config>("./config.json")
    : { apiUrl: "https://api.example.com", features: {}, updatedAt: "" };

  // Mutate.
  current.features[name] = enabled;
  current.updatedAt = new Date().toISOString();

  // Write atomically — any watcher sees the old config or the new, never a
  // truncated half-written JSON file.
  await atomicWriteJsonAsync("./config.json", current);
}

await setFeature("dark-mode", true);
```

## Why each call

**`fileExistsAsync` + fallback.** Better than try/catching the read —
makes the "first run, no file yet" branch explicit and removes the
ENOENT-as-control-flow smell.

**`getJsonFileAsync<Config>`.** Typed read. If the file's been corrupted
(someone hand-edited it badly), this throws `SyntaxError` — let it bubble
up so the calling code knows.

**Mutate in memory.** The mutation is a plain object assignment. Nothing
touches disk between read and write.

**`atomicWriteJsonAsync`.** The whole point — readers see the old file or
the new file, never a half-written one. A crash between the read and the
write leaves the file unchanged.

## What this doesn't protect against

**Lost updates.** If two callers run `setFeature` concurrently, they both
read the same starting state and one of their writes is silently
overwritten by the other. The atomic write doesn't lock — it just makes
each individual write safe to observe.

If lost updates matter, wrap the read-modify-write in a lock. Two
options:

- **In-process** — use a simple `async`-aware mutex (any small library, or
  hand-rolled with a Promise queue).
- **Cross-process** — `@warlock.js/cache`'s `cache.lock()` backed by
  Redis or Postgres.

```ts
import { cache } from "@warlock.js/cache";

// cache.lock(key, ttl, fn) acquires, runs, and auto-releases.
const outcome = await cache.lock("config.json", "1m", async () => {
  // Same read-modify-write as above, but now serialized across the cluster.
  await setFeature("dark-mode", true);
});

if (!outcome.acquired) {
  // Another worker holds the lock — your fn did not run.
}
```

## Variation: append-only journal

Same idea, different shape — an event log where each call adds an entry:

```ts
import { getJsonFileAsync, atomicWriteJsonAsync, fileExistsAsync } from "@warlock.js/fs";

type Event = { ts: string; type: string; payload: unknown };

async function appendEvent(event: Event) {
  const existing: Event[] = (await fileExistsAsync("./events.json"))
    ? await getJsonFileAsync<Event[]>("./events.json")
    : [];

  existing.push(event);
  await atomicWriteJsonAsync("./events.json", existing);
}
```

Same lost-update caveat applies — under concurrent appends, only one
writer's append survives. For a real event log, use a database or a
proper append-only file format (NDJSON with `appendFile`); the recipe
above is for low-volume single-writer logs (build emitters, CLI tools).

## Related

- [Write atomically](../guides/write-atomically) — the underlying
  mechanism.
- [Atomic vs non-atomic](../essentials/02-atomic-vs-non-atomic) — when to
  reach for atomic vs plain writes.
