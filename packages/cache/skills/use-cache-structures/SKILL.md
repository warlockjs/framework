---
name: use-cache-structures
description: 'Probabilistic structures on the cache manager — cache.structures.bloom, cuckoo, uniqueCounter (HyperLogLog, .merge), frequency (Count-Min + Top-K) on redis and memory drivers. Triggers: `cache.structures`, "username taken check", "daily active users", "top search terms", "bloom filter"; other drivers throw `CacheUnsupportedError`. Skip: exact sets — `cache.list`; exact counters — `use-cache-atomic`.'
---

# `cache.structures`

Small structures that trade a known error for tiny memory. Supported on `redis` (RedisBloom when present, plain Redis otherwise) and `memory` / `memoryExtended` / `lru`. All other drivers throw `CacheUnsupportedError`. Every structure takes `ttl`, applied when it is first written and never pushed back.

```ts
const names = cache.structures.bloom("users.usernames", {
  expectedItems: 1_000_000,
  errorRate: 0.01,
});
await names.add("hasan");
await names.mightContain(input); // false = definitely free

const banned = cache.structures.cuckoo("users.banned", { expectedItems: 100_000 });
await banned.add(id);
await banned.remove(id); // only remove what was added

const dau = cache.structures.uniqueCounter(`stats.dau.${today}`, { ttl: "40d" });
await dau.add(userId);
await dau.count();
await cache.structures.uniqueCounter.merge(lastSevenDaysKeys).count();

const terms = cache.structures.frequency("search.terms", {
  width: 2000,
  depth: 5,
  topK: 100,
  ttl: "1h",
});
await terms.add(term);
await terms.estimate("laptop");
await terms.top(10); // [{ value, count }]
```

## Facts

- Bloom: 1M items at 1% is about 1.2 MB, 7 hashes. No removal, no listing. Not for exact "yes" decisions.
- Cuckoo: real filter on RedisBloom; a counting Bloom filter elsewhere. Removing a never-added item corrupts it.
- Unique counter: 12 KB, standard error 0.81%. Cannot answer "was X counted". Not for billing.
- Frequency: 2000 x 5 is about 40 KB. Estimates are never below the true count. Not for rare values.
- Keys follow the driver prefix and are stored as `structures.<kind>.<key>`.
- A custom driver opts in with `structuresBackend(): CacheStructuresBackend` (the `StructuresCapable` shape; `isStructuresCapable(driver)` checks it). It can return a built-in backend instead of writing its own: `new MemoryStructuresBackend((key) => this.parseKey(key))`, created once and reused, or `new RedisStructuresBackend(() => client, (key) => this.parseKey(key))` for a driver that wraps a Redis client.
- Handle types for annotations: `BloomFilter`, `CuckooFilter`, `UniqueCounter`, `UniqueCounterGroup` (from `uniqueCounter.merge`), `FrequencyTracker`. Create them through `cache.structures`, never with `new`.

Docs: `/v/latest/cache/structures/`.
