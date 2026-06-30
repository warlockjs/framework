---
title: "Production Hardening Checklist"
description: The concrete knobs to set before a Warlock app goes live — body limits, trusted-proxy config, storage key sanitization, secrets, health/readiness wiring, graceful shutdown, and logging redaction — each tied to the config key that controls it and the page that explains it.
sidebar:
  order: 15
  label: "Production Hardening Checklist"
---

A run-through of the settings that matter before you put a Warlock app behind real traffic. Every item names the **config key or API that controls it** and links to the page with the full story. Where a setting only protects a single instance, this page says so and points at [Known Limitations](./known-limitations.md).

Work top to bottom — the order roughly follows boot: secrets first, then the transport surface, then the operational wiring.

## Secrets & crypto

- [ ] **Keep secrets in `.env`, read through `env()` into a config file — never hard-coded.** Keep `.env` out of version control.
- [ ] **Set `APP_ENCRYPTION_KEY` (and ideally a separate `APP_HMAC_KEY`).** A missing key throws on the first `encrypt()` call at runtime, not at boot — add a startup pre-flight so a bad deploy fails fast. Use a fresh 32-byte key: `crypto.randomBytes(32).toString("hex")`. See [Encryption](./encryption.md).
- [ ] **Hash passwords with `hashPassword`** (bcrypt) — never `encrypt` or `hmacHash`. Encrypt recoverable secrets, fingerprint them with `hmacHash` for lookup, and decrypt only at the moment of use. See [Encryption](./encryption.md).

## Request surface (body limits & input)

- [ ] **Lower `http.bodyLimit`** from the historical default for production, and add `middleware.maxBodySize()` on routes that accept user payloads. An unbounded body is a denial-of-service vector. See [Security → hardening checklist](./security.md).
- [ ] **Attach a validation schema to every controller that takes input.** Constrain enums, lengths, and required fields so malformed input is rejected before the handler runs. See [Validation](../the-basics/validation.md).
- [ ] **Sanitize storage keys and locations derived from request input.** Never pass a raw filename / `:id` / `?path=` into `storage.get/put/path`. The local driver rejects paths that escape the storage root, but you should still restrict keys to a known per-tenant prefix and strip `..` segments — and cloud drivers have no filesystem root to contain you, so sanitization is entirely on you there. See [Storage → gotchas](./storage.md).

## Trusted proxy & transport

- [ ] **Decide who you trust for `X-Forwarded-For`.** Fastify runs with `trustProxy: true`, so `request.detectIp()`, `middleware.ipFilter()`, and IP-scoped rate limiting honor client-settable forwarding headers. Only deploy behind a proxy you control that overwrites those headers — otherwise the client IP can be spoofed. See [Known Limitations → transport & proxy trust](./known-limitations.md).
- [ ] **Lock down CORS** via `http.cors` — but verify the permissive-default gotcha first (`origin` / `methods` may not be overridable through config yet; confirm against `src/http/plugins.ts`). See [Security → CORS](./security.md).
- [ ] **Sign cookies** by setting `http.cookies.secret` whenever a cookie value must not be client-forgeable. See [Security](./security.md).
- [ ] **Keep `http.requestId` enabled** so every request is traceable end-to-end; inherited ids are already validated against log-injection. See [Security](./security.md).

## Abuse & rate limiting

- [ ] **Add `middleware.rateLimit()`** to login, OTP, password-reset, and other abuse-prone endpoints — tighter than the global `http.rateLimit` backstop.
- [ ] **Add `middleware.concurrencyLimit()`** to unbounded-cost endpoints (report generation, AI completions, image processing).
- [ ] **Require `middleware.idempotency()` after auth** on non-idempotent writes (`POST` / `PUT` / `PATCH` / `DELETE`) that clients may retry.
- [ ] **If you run more than one replica, give the above a shared store.** Their counters and keys are process-local by default — point `http.rateLimit` at a Redis store and idempotency at a shared cache, or treat the limits as best-effort. See [Known Limitations → single-instance state](./known-limitations.md).

## Health, readiness & graceful shutdown

- [ ] **Wire your load balancer to `/ready`, not `/health`.** `/health` is liveness ("should you restart me?") and ignores dependency checks; `/ready` is readiness ("should you route to me?") and gates on boot completion, shutdown state, and your registered checks. See [Health checks](./health-checks.md).
- [ ] **Register readiness checks for critical dependencies** (database ping, cache round-trip) so `/ready` reports `503` when a dependency is down. Keep each check cheap — they run on every poll.
- [ ] **Make your supervisor send `SIGTERM` (or `SIGINT`), never only `SIGKILL`.** Graceful, reverse-order connector teardown only runs for terminable signals; a hard kill drops in-flight connections. Allow a short grace period. See [Deployment → graceful shutdown](./deployment.md).
- [ ] **Add an `Application.onShutdown(...)` delay matched to your LB's health-check interval** so the balancer observes the `503` and drains the instance before the server closes. See [Health checks](./health-checks.md).

## Logging

- [ ] **Configure redaction (`log.setRedact({...})`) for sensitive paths** — tokens, passwords, request bodies — before any channel sees the entry. The redaction floor is logger-wide and additive: channels can redact more, never less. See [Logging → redaction](./logging.md).
- [ ] **Pick a production-appropriate channel** (JSON for ingestion, file for retention) and a level that won't flood, rather than the dev console. See [Logging](./logging.md).

## See also

- **[Known Limitations](./known-limitations.md)** — the honest caveats behind several of these items, especially the single-instance ones.
- **[Security](./security.md)** — the protective middleware and the source hardening checklist this page operationalizes.
- **[Deployment & production](./deployment.md)** — `warlock build` / `start`, environment selection, and the shutdown sequence.
- **[Health checks](./health-checks.md)** — `/health`, `/ready`, the readiness registry, and request draining.
- **[Encryption](./encryption.md)** — `APP_ENCRYPTION_KEY`, the three crypto helpers, and key handling.
- **[Storage](./storage.md)** — the storage surface and the key-sanitization gotcha.
- **[Logging](./logging.md)** — channels and redaction.
