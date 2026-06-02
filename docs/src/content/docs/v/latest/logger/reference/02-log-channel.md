---
title: "LogChannel"
description: "The abstract base class for custom channels — fields, lifecycle, and protected helpers."
sidebar:
  order: 2
  label: "LogChannel"
---

`LogChannel<Options>` is the abstract base class every built-in channel extends. Subclass it to build a custom channel — you only need to implement `log()`; the base handles configuration merging, level + filter checks, and date formatting. It already satisfies `LogContract`.

See [Custom Channel](../channels/05-custom/) for the usage guide.

```ts
abstract class LogChannel<Options extends BasicLogConfigurations = BasicLogConfigurations>
  implements LogContract
```

## Public members

| Member | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique identifier for the channel. Set it on your subclass. |
| `description` | `string?` | Optional human-readable description. |
| `terminal` | `boolean` | `true` preserves ANSI codes in the message; `false` (default) means the logger strips them via `clearMessage()` before the entry arrives. |
| `constructor` | `(configurations?: Options)` | Accepts the channel's options. Schedules `init()` on the next tick. |
| `log` | `abstract (data: LoggingData): void \| Promise<void>` | **Implement this.** Your write/send logic. |
| `flushSync` | `(): void` *(optional)* | Implement when the channel buffers in memory and needs a synchronous drain on shutdown. |
| `getRedactConfig` | `(): RedactConfig \| undefined` | Returns the channel's `redact` config (additive on top of the logger-wide floor). Subclasses normally don't override — set `redact` in the channel options instead. |

## Protected members (for subclasses)

| Member | Type | Description |
| --- | --- | --- |
| `init` | `(): void \| Promise<void>` *(optional hook)* | One-time async setup, called once after construction. The channel is marked ready once it resolves. |
| `defaultConfigurations` | `Options` | Override to provide option defaults (merged under user-supplied config). |
| `channelConfigurations` | `Options` | The user-supplied config (merged over defaults). |
| `isInitialized` | `boolean` | `true` once `init()` has resolved. |
| `config` | `<K extends keyof Options>(key: K): Options[K]` | Type-safe accessor — returns the channel config value, falling back to the default. |
| `setConfigurations` | `(configurations: Options): this` | Merge more options into the channel config. |
| `shouldBeLogged` | `(data: LoggingData): boolean` | `false` if `data.type` isn't in `levels`, or if the `filter` predicate returns `false`. Call it at the top of your `log()`. |
| `getDateAndTimeFormat` | `(): { date: string; time: string }` | The resolved Day.js date/time format strings (config or defaults `"DD-MM-YYYY"` / `"HH:mm:ss"`). |
| `withBasicConfigurations` | `(configurations: Partial<Options>): Options` | Factory helper merging a partial config with a pass-through `filter` baseline. |

## Initialization timing

The constructor schedules `init()` via `setTimeout(0)` and flips `isInitialized` to `true` once it resolves. Entries logged in the first tick — before `init()` completes — can reach `log()` before async setup finishes. Guard against half-initialized resources in your `log()`, or buffer until ready. See [Custom Channel](../channels/05-custom/).

## See also

- [Custom Channel](../channels/05-custom/) — the step-by-step guide with worked examples
- [Channel configurations](./03-channel-configurations/) — the built-in channel option shapes
- [Types](./04-types/) — `LogContract`, `BasicLogConfigurations`, `LoggingData`
