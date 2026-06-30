---
title: "Redact secrets"
description: redact() deep-copies a value with any property whose KEY matches a sensitive fragment replaced by a placeholder — one key-driven redaction policy shared by VCR cassettes, Panoptic capture, and error/cause serialization, plus scrubSecrets() for free-text and redactError() for errors.
sidebar:
  order: 14
  label: "Redact secrets"
---

`redact(value, options?)` deep-copies a value with any property whose **key** matches a sensitive fragment replaced by a placeholder. It is **key-driven, not value-driven** — it never guesses that a bare string is a secret; it only redacts when the *key* looks sensitive (`authorization`, `apiKey`, `cookie`, `password`, `token`, …). One shared redaction policy backs three trust-boundary surfaces — [VCR cassettes](../best-practices/record-replay-testing), [Panoptic content capture](../observability/what-panoptic-traces), and the error / cause serializer — instead of three divergent guards.

This is **not** [`ai.guardrail`](./guardrails). Guardrails are agent middleware that inspect prompt / output / tool content at runtime and emit `allow` / `redact` / `block` / `flag` verdicts. `redact()` is a plain synchronous utility for scrubbing structured payloads (recorded requests, error causes, captured traces) before they are stored or exported.

## `redact(value, options?)`

```ts
import { redact } from "@warlock.js/ai";

const safe = redact({
  url: "https://api.openai.com/v1/chat/completions",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer sk-live-abc123",   // key is sensitive → redacted
    "x-api-key": "secret-value",               // redacted
  },
  body: { model: "gpt-4o", apiKey: "leaked" }, // nested apiKey → redacted
});

// {
//   url: "https://api.openai.com/v1/chat/completions",   // untouched (key not sensitive)
//   headers: {
//     "content-type": "application/json",
//     authorization: "[redacted]",
//     "x-api-key": "[redacted]",
//   },
//   body: { model: "gpt-4o", apiKey: "[redacted]" },
// }
```

It returns a **new** value of the same type `T` — the input is never mutated. Primitives pass straight through, arrays are walked element-wise, and plain objects are rebuilt key by key.

### Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `keys` | `string[]` | — | Extra key fragments to redact, **merged** with `DEFAULT_SENSITIVE_KEYS`. Matched case-insensitively as substrings of each object key. |
| `placeholder` | `string` | `"[redacted]"` | Replacement value substituted for a redacted property (and for collapsed circular / over-deep branches). |
| `maxDepth` | `number` | `8` | Maximum recursion depth before a branch collapses to the placeholder. |

### Matching is substring, case-insensitive

A key is sensitive when its lower-cased form **contains** any fragment. So `Authorization`, `authorizationHeader`, and `X-Authorization` all match the `authorization` fragment. The built-in set:

```ts
import { DEFAULT_SENSITIVE_KEYS } from "@warlock.js/ai";

// "authorization", "x-api-key", "api-key", "apikey", "cookie", "set-cookie",
// "password", "passwd", "secret", "token", "access_token", "refresh_token",
// "client_secret", "private_key", "session"
```

Add your own fragments without losing the defaults:

```ts
const safe = redact(payload, { keys: ["ssn", "card_number"], placeholder: "***" });
```

:::note
Redaction is key-driven by design — a token embedded **inside** a string value (e.g. `"failed for sk-live-abc123"`) is invisible to `redact()`. Use [`scrubSecrets`](#scrubsecretstext) for free-form text.
:::

### Cycles and depth

Circular references and trees deeper than `maxDepth` collapse to the `placeholder` rather than throwing or looping:

```ts
const node: any = { name: "root" };
node.self = node;                 // circular
redact(node);                     // { name: "root", self: "[redacted]" }
```

## `redactHeaders(headers, placeholder?)`

Strip sensitive HTTP headers from a `Headers` instance or a plain record, returning a redacted plain object. Header names are matched case-insensitively against `SENSITIVE_HEADERS` (`authorization`, `x-api-key`, `api-key`, `cookie`, `set-cookie`, `proxy-authorization`).

```ts
import { redactHeaders } from "@warlock.js/ai";

redactHeaders(new Headers({ authorization: "Bearer x", "content-type": "application/json" }));
// { authorization: "[redacted]", "content-type": "application/json" }
```

`placeholder` defaults to `"[redacted]"`; pass a second argument to override. A missing / `undefined` argument returns `{}`.

## `scrubSecrets(text)`

Where `redact()` is key-driven and can't see a secret embedded in a string, `scrubSecrets()` scrubs secrets that appear in **free-form text** — error messages, stack traces, exported log lines. It replaces each known secret shape with `[redacted]` while keeping the surrounding context.

```ts
import { scrubSecrets } from "@warlock.js/ai";

scrubSecrets("request failed: Authorization: Bearer sk-live-abc1234567890123");
// "request failed: Authorization: Bearer [redacted]"
```

Built-in patterns cover `Bearer <token>`, `authorization` / `x-api-key` / `api-key` / `cookie` key-value pairs, OpenAI-style `sk-…` keys, Slack `xox…` tokens, GitHub `ghp_…` / `gho_…` tokens, and AWS `AKIA…` access-key ids.

## `redactError(error, options?)`

Produce a serialized, secret-free view of an error — safe to log, persist, or ship across a boundary.

```ts
import { redactError } from "@warlock.js/ai";

const safe = redactError(providerError);
// {
//   name: "ProviderAuthError",
//   message: "...",
//   code: "PROVIDER_AUTH",
//   cause: { headers: { authorization: "[redacted]", ... } }, // deep-redacted
// }
```

It returns a `RedactedError`:

```ts
type RedactedError = {
  name: string;
  message: string;
  code?: string;
  cause?: unknown;   // deep-redacted via redact()
  stack?: string;    // only when includeStack: true
};
```

Behavior:

- **`stack` is omitted by default** — a stack can embed local paths, endpoints, and tokens. Pass `includeStack: true` only for a trusted local sink.
- The retained **`cause` is deep-redacted via `redact()`**, so a raw provider SDK error carrying `Authorization` / `x-api-key` on `cause.headers` is sanitized.
- Any remaining `RedactOptions` (`keys`, `placeholder`, `maxDepth`) are forwarded to the `cause` redaction.
- A non-object error (string, number, `null`) returns `{ name: "Error", message: String(error) }`.

```ts
redactError(err, { includeStack: true, keys: ["ssn"], placeholder: "***" });
```

## Related

- [Guardrails](./guardrails) — runtime content detectors (`ai.guardrail`); not the same as this key-driven utility.
- [Handle errors](./handle-errors) — the typed `AIError` hierarchy whose `cause` `redactError` sanitizes.
- [Record / replay testing](../best-practices/record-replay-testing) — VCR cassettes redact recorded requests with this policy.
- [What Panoptic traces](../observability/what-panoptic-traces) — captured content runs through the same redaction.
- [Log AI calls](./log-ai-calls) — channel-level redaction for logs (a separate `@warlock.js/logger` feature).
- [API reference](../reference/api) — full export index.
