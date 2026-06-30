---
title: "Outbound policy (SSRF guard)"
description: OutboundPolicy is the shared SSRF and resource-exhaustion guard for every server-side fetch the framework makes on a user's behalf — https-only, post-DNS private-IP deny, byte cap, timeout. resolveOutboundPolicy fills the strict defaults; guardedFetch / fetchTextWithPolicy enforce them.
sidebar:
  order: 13
  label: "Outbound policy (SSRF guard)"
---

Some agent surfaces fetch remote content on the user's behalf — a remote-text attachment, a URL skill source, a future RAG document loader. Those URLs are frequently user-controlled, so an unguarded `fetch()` is an [SSRF](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery) hole (point it at `http://169.254.169.254/` and read cloud metadata) and a resource-exhaustion hole (point it at a multi-gigabyte body).

`OutboundPolicy` is the one audited guard those surfaces share, instead of six ad-hoc `fetch()` call sites. It is `https`-only, denies any host that *resolves to* a private / reserved address, caps the response body, and enforces a timeout — all on by default. A policy violation throws an `OutboundPolicyError`.

## When you touch it

You rarely call the helpers directly — you usually just hand an `OutboundPolicy` to a surface that fetches:

- **Remote-text attachments** — `AgentConfig.attachmentPolicy.outbound` (or per-call `AgentExecuteOptions.attachmentPolicy`). Note remote fetch is itself default-denied — see [Attach middleware](./attach-middleware).
- **URL skill sources** — the `policy` field on a `url` skill source. See [Runtime skills](./runtime-skills).
- **Your own loaders** — call `guardedFetch` / `fetchTextWithPolicy` when you fetch user-supplied URLs in tool or step code.

Reach for the standalone helpers (`resolveOutboundPolicy`, `guardedFetch`, `fetchTextWithPolicy`, `assertUrlAllowed`, `readTextCapped`, `isPrivateOrReservedIp`) when you write that last category — code that fetches a URL you don't fully trust.

## The policy shape

`OutboundPolicy` has only optional fields; every default is filled by `resolveOutboundPolicy`. The defaults are deliberately strict, so a caller that opts into a fetch without tuning still gets a hardened request.

```ts
import type { OutboundPolicy } from "@warlock.js/ai";

const policy: OutboundPolicy = {
  allowedSchemes: ["https"],          // default ["https"] — http must be opted in
  hostAllowlist: ["cdn.example.com"], // when set, host must equal or be a subdomain
  maxBytes: 1_000_000,                // default 5 MiB
  timeoutMs: 5_000,                   // default 10s
};
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowedSchemes` | `string[]` | `["https"]` | URL schemes permitted, compared case-insensitively against the protocol (no trailing colon). `http` must be opted in explicitly. |
| `hostAllowlist` | `string[]` | _(none)_ | When set, the request host must equal an entry **or be a subdomain** of one (`cdn.example.com` allows `a.cdn.example.com`). When omitted, any host passes the allowlist check — the private-IP guard still applies. |
| `denyPrivateIPsAfterDNS` | `boolean` | `true` | Resolve the host through DNS and reject when it maps to a private / loopback / link-local / unique-local / cloud-metadata (`169.254.169.254`) address. The core SSRF guard — catches a public hostname that resolves inward. |
| `maxBytes` | `number` | `5_242_880` (5 MiB) | Max response body in bytes. A declared `content-length` over this fails fast; otherwise the body is read with a running cap and aborted on overflow. |
| `timeoutMs` | `number` | `10_000` | Per-request timeout in milliseconds. |
| `signal` | `AbortSignal` | _(none)_ | Caller signal, merged with the internal timeout — whichever fires first aborts the request. |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Injected `fetch` implementation (for tests, proxies, or a wrapper that already enforces app-level rules). |

## `resolveOutboundPolicy(policy?)`

Fills a partial `OutboundPolicy` (or `undefined`) with the strict defaults above, returning a `ResolvedOutboundPolicy` — the same shape with every default applied, never partial. It is **idempotent**: resolving an already-resolved policy yields the same shape, so the enforcement helpers below call it freely without double-resolving cost.

```ts
import { resolveOutboundPolicy } from "@warlock.js/ai";

const resolved = resolveOutboundPolicy();
// {
//   allowedSchemes: ["https"],
//   denyPrivateIPsAfterDNS: true,
//   maxBytes: 5_242_880,
//   timeoutMs: 10_000,
//   fetch: globalThis.fetch,
//   hostAllowlist: undefined,
//   signal: undefined,
// }

const tuned = resolveOutboundPolicy({ allowedSchemes: ["https", "http"], maxBytes: 1_000_000 });
```

`ResolvedOutboundPolicy` is what `assertUrlAllowed` and `readTextCapped` accept — call `resolveOutboundPolicy` first when you use those two directly.

## Enforcing a fetch

### `fetchTextWithPolicy(url, policy, init?)` — the convenience entry

The one-shot helper: validate the URL, fetch with the timeout, then read the (capped) body — but only when the response is OK. It returns the status alongside the text so you shape your own not-OK error.

```ts
import { fetchTextWithPolicy } from "@warlock.js/ai";

const { ok, status, statusText, text } = await fetchTextWithPolicy(
  userSuppliedUrl,
  { hostAllowlist: ["cdn.example.com"], maxBytes: 1_000_000 },
);

if (!ok) {
  throw new Error(`fetch failed: ${status} ${statusText}`);
}

// `text` is guaranteed <= maxBytes; the body is only read on an OK response.
```

Returns `{ ok: boolean; status: number; statusText: string; text: string }`. `text` is `""` when the response is not OK (the body is never read in that case).

### `guardedFetch(url, policy, init?)` — when you need the `Response`

Validates the URL, then performs the request with the policy timeout (and your optional `signal`) merged, and returns the raw `Response`. Use it when you need headers, a binary body, or streaming — then read the body yourself with `readTextCapped` to keep the byte cap.

```ts
import { guardedFetch, readTextCapped, resolveOutboundPolicy } from "@warlock.js/ai";

const policy = resolveOutboundPolicy({ allowedSchemes: ["https"] });
const response = await guardedFetch(url, policy, { headers: { accept: "text/markdown" } });

if (!response.ok) {
  // shape your own error
}

const body = await readTextCapped(response, policy.maxBytes);
```

:::caution
`guardedFetch` returns the body **unread**. The byte cap is only enforced when you read it through `readTextCapped` — reading the `Response` any other way (`response.text()`, `response.arrayBuffer()`) bypasses `maxBytes`.
:::

### `readTextCapped(response, maxBytes)`

Reads a `Response` body as UTF-8 text with a hard byte cap. A declared `content-length` over the cap fails fast; otherwise the stream is read chunk-by-chunk and aborted the instant the running total exceeds `maxBytes`. Throws `OutboundPolicyError` on overflow.

### `assertUrlAllowed(url, resolvedPolicy)`

The validation step `guardedFetch` runs internally, exposed so you can pre-flight a URL **before** any network call: it checks the scheme allowlist, the host allowlist, and (when `denyPrivateIPsAfterDNS` is on) resolves the host via DNS and rejects any private / reserved address. Returns the parsed `URL` on success; throws `OutboundPolicyError` otherwise.

```ts
import { assertUrlAllowed, resolveOutboundPolicy } from "@warlock.js/ai";

const policy = resolveOutboundPolicy({ hostAllowlist: ["api.example.com"] });
const url = await assertUrlAllowed(candidate, policy); // throws OutboundPolicyError if blocked
```

It takes a **resolved** policy — call `resolveOutboundPolicy` first.

## The SSRF guard — fail closed

`denyPrivateIPsAfterDNS` is the heart of the protection, and it fails **closed**:

- An **IP literal** is checked directly — `http://10.0.0.1/`, `http://[::1]/`, `http://169.254.169.254/` are all rejected.
- A **hostname** is resolved via DNS and **every** returned address is checked, so a public-looking name that resolves inward (a DNS-rebinding or metadata-pointing host) is caught.
- A **resolution failure** is itself a block — if the host can't be resolved to verify it is public, the request is denied, not allowed.

`isPrivateOrReservedIp(address)` is exported standalone if you want the same private / loopback / link-local / unique-local / metadata classification in your own checks.

```ts
import { isPrivateOrReservedIp } from "@warlock.js/ai";

isPrivateOrReservedIp("10.0.0.1");          // true
isPrivateOrReservedIp("169.254.169.254");   // true (cloud metadata)
isPrivateOrReservedIp("::1");               // true (IPv6 loopback)
isPrivateOrReservedIp("93.184.216.34");     // false
```

## Errors

Every block, timeout, and overflow throws `OutboundPolicyError` (an `AIError` subclass) with a descriptive message and a structured `context` (the offending URL, host, address, scheme, declared size, or timeout). Catch it where you call the helper directly:

```ts
import { OutboundPolicyError } from "@warlock.js/ai";

try {
  await fetchTextWithPolicy(url, policy);
} catch (error) {
  if (error instanceof OutboundPolicyError) {
    // error.context — { url, host?, address?, scheme?, ... }
  }
}
```

When the policy is enforced *inside* a managed surface (an agent attachment, a skill source), the `OutboundPolicyError` lands on that surface's result envelope rather than throwing past `execute()` — see [Handle errors](./handle-errors).

## Related

- [Attach middleware](./attach-middleware) — `AgentConfig.attachmentPolicy`, where `outbound` and `allowRemoteFetch` live.
- [Runtime skills](./runtime-skills) — URL skill sources that carry an `OutboundPolicy`.
- [Define tools](../the-basics/define-tools) — tool / step code is where you most often fetch a user-supplied URL.
- [Handle errors](./handle-errors) — how `OutboundPolicyError` surfaces on the result envelope.
- [API reference](../reference/api) — full export list.
