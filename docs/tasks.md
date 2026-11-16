# Open tasks

Open work for the framework repository. Finished entries move to `tasks.completed.md` (newest first).

## Owner decisions waiting

- T-007: coding-CLI adapters: change the `inheritEnv` default from inheriting everything to `"curated"`?
- T-008: release workflow: provenance / trusted publishing, a separate unprivileged gate job, write token out of the test step?
- T-009: next-major default flips (passkey user verification, login `emailLock`, multipart `routes`, `ai.serve` auth, short JWT secrets, JSON-lines file logs).
- T-010: encryption-key and JWT-secret rotation (previous keys accepted for reading): build it, and in which shape?
- T-011: model-level protected columns against mass assignment: which design?
- T-033: should `CapturedMessage.content` become text-only for multipart messages?
- T-111: request locale order: should the explicit `locale` header win over a `locale` cookie?
- T-112: `request.validated()` on a route with no schema: keep the silent `{}`, warn, or throw?
- T-113: `web.robots`: allow a per-site policy, and in which shape?
- T-114: unknown API routes: answer the app's error shape (code, translated message, request id) instead of a fixed English body?

## Tasks

Ordered by value: security first, then performance, then features and bugs. Line numbers are as of 5.53.0; entries
T-100 and later are checked against 5.53.1.

### T-007 [decision] Coding-CLI adapters inherit the whole host environment by default

- Source: security and performance audit of 2026-11-11.
- What and why: a coding-CLI agent (`@warlock.js/ai-cli`) starts the external CLI with every variable of the host
  process (`inheritEnv: true`), so database URLs, cloud keys and other app secrets reach a tool driven by model
  output. 5.53.0 added `inheritEnv: "curated"` (a minimal system set plus the adapter's own `apiKeyEnv`) and a
  one-time production warning when `inheritEnv` is unset, but kept the default.
- Evidence: `packages/ai-cli/src/cli-agent.ts:123`, `:262-266`; `packages/ai-cli/src/session/environment.ts:41-75`,
  `:124-152`; `packages/ai-cli/src/contracts/options.type.ts:51-65`.
- Options: (a) flip the default to `"curated"` in the next minor with an upgrade note (apps that rely on extra
  variables must list them in `inheritEnv: [...]` or `env`); (b) flip it in the next major; (c) keep `true` and the
  warning.
- Recommendation: (b), after T-013 lets adapters declare the extra variables they need (base URLs, provider keys),
  so the curated set works for every built-in adapter without app changes.
- Acceptance: the chosen default ships with docs, skill, changelog and an upgrade note; a spec runs a fake CLI under
  the default and shows an unrelated secret absent and the adapter's credential present.
- Status: open.
- Owner decision: which option.

### T-008 [decision] Release workflow: provenance, unprivileged gate job, write token out of the test step

- Source: security and performance audit of 2026-11-11.
- What and why: one `release` job holds `contents: write` and runs the whole gate (tests, builds, installs from a
  local registry) with that token in the step's git config, then publishes with `NPM_TOKEN`. Code executed by the
  tests can read the write token. Actions are now pinned by commit SHA; the rest changes how releases are authorised.
- Evidence: `.github/workflows/release.yml:38-45` (job and permissions), `:177-187` (gate step with
  `GIT_CONFIG_*` carrying `github.token`), `:213-219` (publish step); `tools/release/scripts/release-family.ts` (gate
  branch check runs `git ls-remote --symref origin HEAD`).
- Options: (a) split into a read-only gate job and a publish job that downloads the gate's tarballs and needs
  `contents: write` + `id-token: write`; (b) keep one job but have `release-family.ts` drop `GIT_CONFIG_*` from the
  environment of test children; (c) add npm trusted publishing / `--provenance` (needs `id-token: write` and an npm
  trusted-publisher entry per package).
- Recommendation: (a) + (c): the gate runs with `contents: read`, the publish job never runs app code, and every
  tarball carries provenance. (b) is a stop-gap if (a) is deferred.
- Acceptance: no step that runs tests or package scripts has a write-scoped token; published packages show
  provenance on npm; one dry-run release succeeds end to end.
- Status: open.
- Owner decision: approve the split and trusted publishing (it changes how releases are authorised).

### T-009 [decision] Next-major default flips

- Source: security and performance audit of 2026-11-11.
- What and why: 5.53.0 shipped these as opt-ins or warnings to stay compatible. Each is safer as a default.
  1. `auth.passkeys.userVerification`: `"preferred"` → `"required"` (`packages/auth/src/services/auth-config.ts:374-375`).
  2. `loginThrottleMiddleware` `emailLock`: `"global"` → `"pair"`, so one IP cannot lock a victim's account from
     everywhere (`packages/auth/src/middleware/login-throttle.middleware.ts:87`, `:317`).
  3. `http.multipart.routes`: `"all"` → `"declared"`, so multipart bodies are parsed only on routes that take files
     (`packages/core/src/http/multipart.ts:42-51`). Needs T-012 first: web page actions cannot declare uploads yet.
  4. `ai.serve` refuses to start without `authToken`/`authorize` unless `public: true` (today a production warning,
     `packages/ai/src/serve/serve.ts:189`, `:400`).
  5. A boot error for JWT secrets under 32 bytes (today a production warning,
     `packages/auth/src/services/auth-config.ts:56-60`, `:198`, `:411`).
  6. JSON file logs default to `format: "jsonl"` (append-only, no read-modify-write;
     `packages/logger/src/channels/json-file-log.ts:85`).
     Other permissive defaults that could be reviewed at the same time: `attachmentPolicy.allowBareLocalPaths`
     (`packages/ai/src/utils/prepare-attachment-part.ts:268-284`) and `web.tlsAskAllow: "any"`
     (`packages/web/src/configurations.ts:108`).
- Options: per item, flip in the next major / keep the current default.
- Recommendation: flip all six in the next major (item 3 only once T-012 has shipped), each with an upgrade note
  naming the setting that restores the old behaviour.
- Acceptance: each chosen flip ships with specs for the new default, docs, skills, changelog and upgrade notes; the
  scaffold no longer sets values that now equal the default.
- Status: open (next major).
- Owner decision: which flips, and when the next major is planned.

### T-010 [decision] Encryption-key and JWT-secret rotation

- Source: comparison with common practice, 2026-11-11.
- What and why: `encryption.key` and the JWT secrets are single values. Rotating a leaked key today makes every
  stored ciphertext unreadable and signs every user out at once, so in practice keys are not rotated.
- Evidence: `packages/core/src/encryption/encrypt.ts:21-30` (one key), `:115` (`decrypt`);
  `packages/auth/src/services/jwt.ts:6-13` (one access secret, refresh falls back to it).
- Options: (a) `encryption.previousKeys: string[]` tried on decrypt only, and `auth.accessToken.previousSecrets` /
  `auth.refreshToken.previousSecrets` tried on verify only; (b) a key id embedded in ciphertexts/tokens (`kid`) with
  a keyring; (c) leave as is and document a manual re-encrypt.
- Recommendation: (a): small, additive, no format change; add (b) later only if apps need more than one rotation in
  flight.
- Acceptance: after rotation, old ciphertexts and tokens still open, new ones use the new key; a spec per path;
  docs and a rotation recipe; `warlock doctor` notes previous keys left configured for long.
- Status: open.
- Owner decision: build it, and which option.

### T-011 [decision] Model-level protected columns against mass assignment

- Source: comparison with common practice, 2026-11-11.
- What and why: `model.merge(request.all())` writes any declared column, including `role` or `isAdmin`. Validated
  input (`request.validated()`) is the documented path, but nothing stops the shortcut.
- Evidence: `packages/cascade/src/model/model.ts:1172-1174` (`merge`); the template's `role` column
  (`packages/create-warlock/templates/warlock/src/app/users/models/user/user.model.ts:32`).
- Options: (a) `static guarded = ["role", ...]` honoured by `merge()`/`create()` with an explicit `forceMerge()`;
  (b) `static fillable` allowlist; (c) a development warning only when `merge()` receives the request's raw input.
- Recommendation: (a) plus (c): a denylist keeps existing models working; the warning catches the pattern early.
- Acceptance: guarded columns are skipped (or refused, per decision) by `merge()`/`create()`, written by the
  explicit method; specs; docs, skill and changelog; the template guards `role`.
- Status: open.
- Owner decision: the design (denylist vs allowlist, skip vs throw).

### T-012 [feature] Page-level `uploads` option for web page actions

- Source: security and performance audit of 2026-11-11.
- What and why: `http.multipart.routes: "declared"` parses multipart bodies only on routes marked `uploads: true`.
  Page action POST routes are registered with `{ isPage: true }` only and nothing in `@warlock.js/web` reads
  `uploads`, so a web app that switches to `"declared"` gets 415 on every page action that takes a file. The
  template therefore sets `routes: "all"`. This is the prerequisite for flipping the default (T-009 item 3).
- Evidence: `packages/web/src/server/install-page-routes.ts:1021`,
  `packages/web/src/server/install-page-routes-from-manifest.ts:788`; `packages/core/src/router/types.ts:338` (`uploads`
  route option); `packages/core/src/http/multipart.ts:42-66`.
- Acceptance: a page module (or its action) can declare uploads, which reaches the POST route's `uploads` option in
  dev and production; a spec posts a file to such an action under `"declared"` (200) and to an undeclared one (415);
  docs, skill, changelog; the template can then move to `"declared"`.
- Status: open.

### T-013 [feature] Coding-CLI adapters declare the extra variables they need

- Source: security and performance audit of 2026-11-11.
- What and why: `inheritEnv: "curated"` passes a minimal system set plus `apiKeyEnv`. Adapters that also need base-URL
  variables or several provider keys (for example a CLI that talks to more than one provider) then fail unless the
  app lists them. An adapter-declared `passEnv` list makes the curated mode work out of the box (prerequisite for
  T-007).
- Evidence: `packages/ai-cli/src/session/environment.ts:41-75`; adapter definitions declare only `apiKeyEnv`
  (`packages/ai-cli/src/adapters/codex.ts:52`, `copilot.ts:55`, `cursor.ts:52`).
- Acceptance: every built-in adapter declares its variables; `"curated"` passes them; spec per adapter shape; docs.
- Status: open.

### T-014 [chore] Run the service-backed integration suites against the 5.53.0 changes

- Source: security and performance audit of 2026-11-11.
- What and why: 5.53.0 was verified with unit specs, fakes and the typecheck. Several changes were never run against
  a real service: auth token lookups `whereIn("token", [digest, raw])` and `OneTimeToken.purgeSpent()` query deletes
  (MongoDB, PostgreSQL); the login-throttle Redis spec; MongoDB nested-update validation under `strictMode`;
  `restore`/`upsert` with global scopes; PostgreSQL checkpoint upsert on the same turn; Redis checkpoint per-turn
  layout; RabbitMQ direct reply-to and reconnect; the template's OTP `atomic()` filters on PostgreSQL; DNS pinning
  against a real rebinding resolver.
- Evidence: `packages/auth/tests/integration/`, `packages/auth/src/middleware/login-throttle.redis.spec.ts`,
  `packages/core/src/http/rate-limit-cache-store.redis.spec.ts`, `packages/cache/src/drivers/redis-cache-driver.integration.spec.ts`,
  `packages/ai/src/checkpoint/pg.ts`, `packages/herald/src/drivers/rabbitmq/rabbitmq-channel.ts`.
- Acceptance: each suite runs green against real services (CI job or a documented local run); any failure becomes
  its own task.
- Status: open.

### T-015 [chore] Template: the `trustProxy` comment still recommends `true`

- Source: security and performance audit of 2026-11-11.
- What and why: since 5.53.0, `trustProxy: true` no longer reads `X-Real-IP`, and a client can spoof the forwarded
  address behind an appending edge. The generated `http.ts` still tells users to "set this to `true`" behind a
  proxy.
- Evidence: `packages/create-warlock/templates/warlock/src/config/http.ts:48-54`.
- Acceptance: the comment recommends a list of the proxy's IPs/CIDRs and names `http.realIpHeader`; template format
  and typecheck specs pass.
- Status: open.

### T-016 [feature] Cloud storage: serve markup uploads as attachments

- Source: security and performance audit of 2026-11-11.
- What and why: uploads whose bytes are SVG/HTML/XML are now stored as `application/octet-stream`. On cloud disks
  the object is still served without `Content-Disposition: attachment` unless the caller passes it, so a bucket with a
  public URL can still be opened inline by some clients.
- Evidence: `packages/core/src/storage/drivers/cloud-driver.ts:436-450`, `:488-501`, `:566-568` (puts take
  `contentDisposition` only from options); `packages/core/src/http/uploaded-file.ts:887-904`.
- Acceptance: a markup upload stored on a cloud disk gets `ContentDisposition: attachment` by default (caller can
  override); spec with a mocked S3 client; docs and changelog.
- Status: open.

### T-017 [feature] Nesting-depth cap for request input keys and JSON bodies

- Source: security and performance audit of 2026-11-11.
- What and why: array indexes in bracket/dotted keys are capped (`http.input.maxArrayIndex`), but nesting depth is not:
  `a[b][c]...` or a deeply nested JSON body builds a deep object that later walks (validation, logging, cloning)
  recurse into.
- Evidence: `packages/core/src/http/request.ts:818-830` (index cap), `:881-911` (`parseBody`).
- Acceptance: `http.input.maxDepth` (generous default, for example 32) drops or refuses deeper keys with a coded
  error; JSON bodies get the same bound; specs; docs and upgrade note.
- Status: open.

### T-018 [feature] Bound how long a document shell may wait

- Source: security and performance audit of 2026-11-11.
- What and why: since the single-pass render, a shell that suspends outside `<Suspense>` waits instead of failing.
  A disconnect stops it, but a connected client keeps the render alive for as long as the promise never settles.
- Evidence: `packages/web/src/server/render-page.ts:874-917`.
- Acceptance: `web.shellTimeout` (milliseconds; default generous, `0` off) aborts a shell that has not become ready
  and escalates to the error page; specs; docs.
- Status: open.

### T-019 [feature] Guardrails for tool results (indirect prompt injection)

- Source: comparison with common practice, 2026-11-11.
- What and why: guard phases are `input`, `output` and `tool` (tool arguments). Text a tool returns (fetched pages,
  file contents) reaches the model unscanned, which is the usual path for injected instructions.
- Evidence: `packages/ai/src/guard/contracts/verdict.type.ts:8`; `packages/ai/src/guard/guard.ts`.
- Acceptance: a `toolResult` phase runs the configured detectors (for example `injection`) on tool output and can
  block, redact or wrap it as untrusted data; specs; docs and skill.
- Status: open.

### T-020 [feature] Refuse non-string input inside the agent run

- Source: security and performance audit of 2026-11-11.
- What and why: `ai.serve` now refuses a non-string `input`, but callers that bypass it can still hand objects to
  the agent at runtime (the type says `string`, nothing checks it).
- Evidence: `packages/ai/src/agent/agent.ts:421-437` (`execute(input: string, ...)`, `stream(input: string, ...)`).
- Acceptance: a non-string input throws `InvalidRequestError` with a message naming what to pass; spec; changelog.
- Status: open.

### T-021 [feature] Outbound address pinning: keep app connect options, cover the skipped cases

- Source: security and performance audit of 2026-11-11.
- What and why: guarded fetches (AI tools, RAG loaders, storage `putFromUrl`) pin connections to checked addresses
  through a new dispatcher built with default connect options. An app that installed its own global dispatcher with a
  private CA or client certificate loses those options for guarded requests; with a proxy dispatcher, an injected
  `fetch`, or a runtime without Node's dispatcher, pinning is skipped and only the pre-check runs.
- Evidence: `packages/ai/src/security/outbound-policy.ts:39`, `:190`, `:250`;
  `packages/core/src/storage/utils/safe-fetch.ts:35`, `:163`, `:222`, `:362`.
- Acceptance: the pinned dispatcher inherits the installed dispatcher's connect options; a skipped pin logs one
  warning naming why; docs list the remaining limits; specs for each case.
- Status: open.

### T-022 [bug] RAG `clear()` also deletes nested namespaces

- Source: security and performance audit of 2026-11-11.
- What and why: `kb.clear()` deletes by key prefix, so clearing `kb.acme` also deletes `kb.acme.private`. Retrieval is
  exact since 5.53.0; deletion is not. Documented as a caveat only.
- Evidence: `packages/ai/src/rag/rag.ts:199-200`.
- Acceptance: `clear()` removes only its own namespace's chunks (needs an exact-namespace delete or key enumeration in
  `@warlock.js/cache`); spec with sibling and nested namespaces; caveat removed from the docs.
- Status: open.

### T-023 [feature] `http_request` tool sends static headers to any host when unrestricted

- Source: security and performance audit of 2026-11-11.
- What and why: with `baseUrl` the tool now keeps static headers (API keys) on the base origin. With neither
  `baseUrl` nor `allowHosts`, static `headers` still go to whatever host the model names.
- Evidence: `packages/ai-tools/src/http/http-request.ts:61-108`, `:222-232`.
- Acceptance: configuring static headers without `baseUrl`/`allowHosts` logs a construction-time warning (or throws,
  per review) and the docs say so; spec.
- Status: open.

### T-024 [feature] Login throttle: a success resets the shared IP bucket

- Source: security and performance audit of 2026-11-11.
- What and why: a successful login clears the counter and lock of every tracked bucket, including the IP bucket. An
  attacker with their own valid account behind one IP can reset that IP's budget between guesses. The per-email
  bucket still bounds guessing on any one account.
- Evidence: `packages/auth/src/middleware/login-throttle.middleware.ts:401-413`.
- Acceptance: a success clears only the buckets keyed by the signed-in identity (email, email+IP); the IP bucket
  expires on its window; spec; docs.
- Status: open.

### T-025 [feature] Password reset: remaining timing difference for known accounts

- Source: security and performance audit of 2026-11-11.
- What and why: delivery now runs after the response, but the token writes (invalidate + issue) still run inline only
  for a known account, so response time still differs slightly between known and unknown emails. The same applies to
  OTP requests.
- Evidence: `packages/auth/src/services/password-reset.ts:63-82`; `packages/auth/src/otp/otp.ts`.
- Acceptance: the lookup and writes for a known account run off the response path (or both branches do equal work);
  spec that holds the lookup pending and shows the call resolving; docs.
- Status: open.

### T-026 [feature] Rehash passwords on login and offer a second hashing algorithm

- Source: comparison with common practice, 2026-11-11.
- What and why: raising `encryption.password.salt` (bcrypt rounds) only affects new hashes; existing users keep the
  old cost forever. bcrypt also truncates at 72 bytes (now warned) and runs on the main thread in the pure-JS build.
- Evidence: `packages/core/src/encryption/password.ts:111-132`, `:154`, `:185`;
  `packages/auth/src/services/auth.service.ts:779-802` (`attemptLogin`).
- Acceptance: `needsRehash(hash)` in core; `attemptLogin` rehashes and saves after a successful check when the cost
  changed (option, default on); optional `encryption.password.driver: "scrypt"` on `node:crypto` (thread pool, no
  dependency) with verify of both formats; specs; docs and skill.
- Status: open.

### T-027 [feature] Stamp global-scope values into an upsert's insert

- Source: security and performance audit of 2026-11-11.
- What and why: upserts now honour global scopes when they match, but an upsert that inserts writes only the given
  data. On a tenant-scoped model a forgotten tenant column creates a row outside every tenant.
- Evidence: `packages/cascade/src/model/methods/write-methods.ts:338-339`;
  `packages/cascade/src/model/methods/query-methods.ts:383-400` (`scopeUpsertFilter`).
- Acceptance: a structured scope declaration (for example `addGlobalScope(name, cb, { stamp: { tenantId } })`) whose
  values are written into inserts made by `create()` and `upsert()`; specs; docs.
- Status: open.

### T-028 [feature] Bind local-disk temporary URL tokens to their disk

- Source: security and performance audit of 2026-11-11.
- What and why: temporary-URL tokens are now bound to the tenant prefix, but not to the disk. Two local disks sharing
  one `signatureKey` accept each other's tokens; the docs tell apps to use one key per disk.
- Evidence: `packages/core/src/storage/drivers/local-driver.ts:76-85`, `:404-430`.
- Acceptance: the driver learns its disk name and signs it into the token (version bump, old tokens rejected); spec
  with two disks and one key; docs.
- Status: open.

### T-029 [feature] Access resolvers may skip the shared cache

- Source: security and performance audit of 2026-11-11.
- What and why: roles and permissions come from the shared cache; a change made without `flush()` (or by another
  process) stays invisible until the entry expires. For `DefaultAccessResolver` the sets are a pure function of the
  loaded user, so caching them only delays role changes.
- Evidence: `packages/access/src/services/default-resolver.ts:26`; `packages/access/src/services/engine.ts:67-82`.
- Acceptance: a resolver-level `cacheable = false` (default resolver opts out) with an upgrade note; specs; docs.
- Status: open.

### T-030 [feature] Injection detector: combining marks, look-alike letters, other separators

- Source: security and performance audit of 2026-11-11.
- What and why: phrases now match through spacing, zero-width and full-width tricks, but combining marks, look-alike
  letters from other scripts and separators other than whitespace, `_`, `-`, `.` still hide a phrase. The detector is
  documented as a heuristic.
- Evidence: `packages/ai/src/guard/detectors/injection.ts:113-117` (normalised matching).
- Acceptance: normalisation strips combining marks and folds a confusables table; specs for each case; matching stays
  linear.
- Status: open.

### T-031 [chore] Release tooling and dependency hygiene

- Source: security and performance audit of 2026-11-11.
- What and why: (1) no gate check fails when a published package's declared range excludes the patched range of a
  known advisory; (2) the source-map stripping step before `npm pack` has its own spec but the call site in the pack
  loop has none; (3) `warlock add mail` still installs `@types/nodemailer` although the installed major ships its own
  types.
- Evidence: `tools/release/scripts/release-family.ts:33`, `:799`;
  `packages/core/src/generations/features/mail.feature.ts:9`.
- Acceptance: a release-gate check reads advisories for direct dependencies and fails on an excluded patched range; a
  spec pins the stripping call; the redundant types package is dropped with a spec update.
- Status: open.

### T-032 [chore] Document the multi-site cache risk of a CDN keyed on `Host`

- Source: security and performance audit of 2026-11-11.
- What and why: the page cache key now uses the selected site's host. A CDN that keys on `Host` but forwards a
  client's `X-Forwarded-Host` can still store site B's page under site A's URL; only the proxy/CDN configuration can
  close it.
- Evidence: `packages/web/src/server/page-route-handler/serve-page-cache-hit.ts:34`, `:54`;
  `docs/src/content/docs/v/latest/web/essentials/10-page-caching.mdx`.
- Acceptance: the page-caching and multi-site docs explain the risk and the CDN setting that closes it.
- Status: open.

### T-033 [decision] Captured messages: text-only `content` for multipart messages

- Source: security and performance audit of 2026-11-11.
- What and why: with `captureMessages`, a multipart message stores its parts flattened to JSON in `content` and the
  original parts in `contentParts`, so attachments are stored twice and every turn re-reads them.
- Evidence: `packages/ai/src/agent/agent.ts:2759` (`captureMessages`);
  `packages/ai/src/contracts/result/execution-report.type.ts:17-24` (documented shape).
- Options: (a) `content` holds only the text parts when `contentParts` is set (documented shape change, minor with an
  upgrade note); (b) the same in the next major; (c) keep the shape.
- Recommendation: (b), unless no app reads `content` of multipart messages, then (a).
- Acceptance: the chosen shape with specs, docs and an upgrade note; session restore still rebuilds messages.
- Status: open.
- Owner decision: which option.

### T-034 [feature] Spool large multipart parts to temporary files

- Source: security and performance audit of 2026-11-11.
- What and why: multipart files are buffered in memory (bounded since 5.53.0 by a 25 MB total per request). Spooling
  parts above a threshold to disk cuts peak memory under concurrent uploads. Deleting temp files on response close
  would break `UploadedFile` instances kept for later (queued jobs), and every storage driver reads the whole buffer
  at save time.
- Evidence: `packages/core/src/http/multipart.ts:85` (`onFile: bufferFilePart`); `packages/core/src/http/uploaded-file.ts`.
- Acceptance: `http.multipart.memoryLimit` (for example 2 MB) streams larger parts to `os.tmpdir()`; `UploadedFile`
  gets a path-backed mode with lazy `buffer()` and streaming `save()` (`storage.putStream`); temp files deleted on
  response close unless `file.keep()`, plus an exit sweep; the whole public surface and its specs unchanged.
- Status: open.

### T-035 [feature] Constant-time repository cache invalidation

- Source: security and performance audit of 2026-11-11.
- What and why: every repository write clears its namespace with `removeNamespace`, which on Redis scans the keyspace.
  Write-heavy apps pay a scan per write.
- Evidence: `packages/core/src/repositories/adapters/cascade/cascade-adapter.ts:59`;
  `packages/cache/src/drivers/redis-cache-driver.ts:151-190`.
- Acceptance: a generation key per namespace (entries keyed under the generation, with a TTL so old generations
  cannot leak on TTL-less drivers) or a per-namespace key index; invalidation costs O(1) round trips; specs on memory
  and Redis fakes; docs.
- Status: open.

### T-036 [feature] Database cache driver: one upsert per `set`, lean `get`

- Source: security and performance audit of 2026-11-11.
- What and why: `DatabaseCacheDriver.set` does a read then an insert or update, and `get` hydrates a model per read.
  A single upsert needs a unique index on `key` that the driver cannot assume today.
- Evidence: `packages/core/src/cache/database-cache-driver.ts:85`, `:128`.
- Acceptance: the cache migration ships the unique index; `set` uses one upsert with `conflictColumns: ["key"]`;
  `get` reads a raw row; specs on both database drivers.
- Status: open.

### T-037 [feature] A cheaper cache `has()`

- Source: security and performance audit of 2026-11-11.
- What and why: `has()` reads and parses the whole value on every driver, because it emits `hit`/`miss` events that
  carry the value.
- Evidence: `packages/cache/src/drivers/base-cache-driver.ts:446`.
- Acceptance: `has()` uses the drivers' `exists()` and emits an event without the value (documented change); specs.
- Status: open.

### T-038 [feature] Cache TTL jitter and serve-stale-on-error

- Source: comparison with common practice, 2026-11-11.
- What and why: entries written together expire together (synchronised misses across keys and instances), and
  `swr()` has no documented fall-back to the stale value when the refresh throws.
- Evidence: `packages/cache/src/drivers/base-cache-driver.ts:530` (`remember`), `:588` (`swr`).
- Acceptance: `ttlJitter` (± percent per set) and `swr({ failSafe: true })` returning the stale entry within its
  stale window when the refresh throws; specs; docs.
- Status: open.

### T-039 [feature] Batch relation loads issued in the same tick

- Source: comparison with common practice, 2026-11-11.
- What and why: `with()` batches, but `model.load()` loads for one model, so
  `Promise.all(posts.map((post) => post.load("author")))` runs N queries.
- Evidence: `packages/cascade/src/model/model.ts:735`.
- Acceptance: `load()` calls for the same (model class, relation) queued in one microtask run as one loader query;
  same for `Model.find(id)` → one `whereIn`; opt-out flag; specs count queries.
- Status: open.

### T-040 [feature] Compile declared response schemas into the response serializer

- Source: comparison with common practice, 2026-11-11.
- What and why: route `responseSchema` only feeds OpenAPI; responses go through plain `JSON.stringify`. Compiling it
  into Fastify's response serializer is faster and drops undeclared fields (a guard against leaking columns).
- Evidence: `packages/core/src/router/types.ts:179`; `packages/core/src/openapi/build-openapi-document.ts:141`.
- Acceptance: opt-in `http.compileResponseSchemas` (or per route) converts the seal output schema to JSON Schema and
  registers it for the declared statuses; specs for speed-neutral correctness and field stripping; docs.
- Status: open.

### T-041 [feature] PostgreSQL: default statement timeout and named prepared statements

- Source: comparison with common practice, 2026-11-11.
- What and why: no default `statement_timeout`, so one runaway query holds a pool connection indefinitely; queries are
  unnamed, so PostgreSQL plans each hot query again.
- Evidence: `packages/cascade/src/drivers/postgres/postgres-driver.ts:162-171`.
- Acceptance: the scaffold sets a statement timeout (for example 30 s) in the PostgreSQL config; optional
  `query.prepare(name)` passes a statement name; specs; docs.
- Status: open.

### T-042 [feature] ORM hydration hot path

- Source: security and performance audit of 2026-11-11.
- What and why: per hydrated row the model resolves its driver twice, allocates `events` and `loadedRelations`
  eagerly, captures every string to restore undeclared date strings, and PostgreSQL sets one `WeakMap` entry per row
  for column types. Making `events`/`loadedRelations` lazy changes the model's own keys, so it needs care.
- Evidence: `packages/cascade/src/model/methods/hydration-methods.ts:14-39`; `packages/cascade/src/model/model.ts:668`,
  `:684`, `:707`; `packages/cascade/src/drivers/postgres/postgres-driver.ts:339`, `:736`, `:1846`.
- Acceptance: date keys computed once per model class; driver resolved once per result set; column types attached
  once per result; lazy `events`/`loadedRelations` only if serialisation and own-key specs stay identical; specs.
- Status: open.

### T-043 [feature] Scoped atomic writes in one statement

- Source: security and performance audit of 2026-11-11.
- What and why: atomic writes on a model with global scopes first fetch the visible ids, then write to them: two round
  trips per write.
- Evidence: `packages/cascade/src/model/methods/query-methods.ts:347-400`.
- Acceptance: a builder-level `atomic()` that composes the scopes into the write filter; one driver call; specs on
  both drivers.
- Status: open.

### T-044 [feature] MongoDB upserts generate an id only when they insert

- Source: security and performance audit of 2026-11-11.
- What and why: every upsert reserves an id before the write, so updates burn ids (and a round trip without
  `idReservationBlockSize`).
- Evidence: `packages/cascade/src/model/methods/query-methods.ts:237` (`withAutoGeneratedUpsertId`), `:426`, `:517`.
- Acceptance: the id is written by a second write keyed on `_id` only when the upsert inserted; specs.
- Status: open.

### T-045 [feature] Sync fan-out: per-document order, per-listener retry, skip when nobody listens

- Source: security and performance audit of 2026-11-11.
- What and why: embedded-copy sync jobs now run one at a time after commit. A retry re-runs every listener of the
  event (including app listeners), and a job is queued even when no listener exists.
- Evidence: `packages/cascade/src/sync/model-events.ts:115-133`.
- Acceptance: configurable concurrency keyed by source document (order kept per document), retry per listener, no job
  for an event without listeners; specs.
- Status: open.

### T-046 [feature] Validation: stop re-walking nested output at every level

- Source: security and performance audit of 2026-11-11.
- What and why: the output of an object nested `d` levels is cleaned of `undefined` values by every ancestor. Walking
  once needs a choice: may nested transformers see uncleaned JavaScript `undefined` values, or may the framework
  assume its outputs are not mutated in place by user callbacks?
- Evidence: `packages/seal/src/validators/object-validator.ts:575`, `:724-739`.
- Acceptance: one walk per validation with the chosen rule pinned by specs; output unchanged for JSON input.
- Status: open.
- Owner decision: which rule (see above).

### T-047 [feature] Validation: synchronous rules where possible (next major)

- Source: security and performance audit of 2026-11-11.
- What and why: every rule and mutator is `async` and the public types require promises, so each field pays microtask
  hops per rule. A sync path needs `MaybePromise` types and explicit error ordering, which breaks plugins that call
  `rule.validate(...).then(...)`.
- Evidence: `packages/seal/src/types/rule-types.ts:47`; `packages/seal/src/types/mutator-types.ts:16`.
- Acceptance: rules/mutators typed `T | Promise<T>`, built-in rules sync, errors collected per index so their order
  does not depend on timing; specs; upgrade guide.
- Status: open (next major).

### T-048 [feature] Data requests skip the server render

- Source: security and performance audit of 2026-11-11.
- What and why: a client navigation (data request) still renders the page on the server only to decide the error page
  and status, then discards the stream. Skipping it moves render-time error reporting to the client boundary.
- Evidence: `packages/web/src/server/render-page.ts:1674` (`attempt.discard()`).
- Acceptance: data requests return the payload without rendering; the client boundary reports render errors; status
  rules documented; specs.
- Status: open.
- Owner decision: accept that render-time errors of data requests are reported by the client.

### T-049 [feature] Memoise translation delivery per route and locale

- Source: security and performance audit of 2026-11-11.
- What and why: pruned translations are rebuilt per request. Memoising needs a registry revision, because the
  localization registry is written in place by `extend()`/`groupedTranslations()` and pages register on first request.
- Evidence: `packages/web/src/translations/delivery.ts:240-264`; `packages/web/src/server/global-translations.ts:107`,
  `:154`; `packages/core/src/localization/register-locale-dictionary.ts:72`.
- Acceptance: core wraps the registration functions and bumps a revision; web memoises `deliver(route, locale)` per
  revision; specs show a registration invalidates the memo.
- Status: open.

### T-050 [feature] Load error and forbidden pages lazily on the client

- Source: security and performance audit of 2026-11-11.
- What and why: the generated client registry imports the error and forbidden pages eagerly, so every route's bundle
  carries them.
- Evidence: `packages/web/src/build/generate-client-registry.ts:192-200`.
- Acceptance: lazy chunks; hydration awaits them only when the payload carries `errorPage`; a Suspense-wrapped lazy
  error page in the client boundary; browser hydration specs.
- Status: open.

### T-051 [feature] Drop the remaining duplicated document slots from the inline payload

- Source: security and performance audit of 2026-11-11.
- What and why: the inline payload repeats stylesheet/preload URLs, font preloads, alternates, entry URL and site key
  that the document head already carries (the nonce must stay).
- Evidence: `packages/web/src/components/scripts.ts:26`; `packages/web/src/client/hydrate-page.tsx`.
- Acceptance: the client rebuilds those slots from the DOM before hydrating; parity specs; smaller payload measured.
- Status: open.

### T-052 [feature] Page cache and sitemap: store compressed, answer 304, serialise once

- Source: security and performance audit of 2026-11-11.
- What and why: page-cache HITs are compressed again on every response; HITs carry no `ETag`, so revalidation always
  sends the body; the JSON variant of a stored entry checks and serialises the payload twice; sitemaps are not gzipped
  unless configured.
- Evidence: `packages/web/src/server/page-route-handler/store-page-cache-after-render.ts:114`, `:231`;
  `packages/web/src/server/page-route-handler/serve-page-cache-hit.ts`; `packages/web/src/sitemap/resolve-sitemap-config.ts:215`.
- Acceptance: entries stored with their encoded bodies (per accepted encoding) and a body hash `ETag` with 304 on
  `If-None-Match`; the JSON variant uses `serializeHydrationPayload`; sitemap gzip default reviewed; specs.
- Status: open.

### T-053 [feature] 103 Early Hints for the hydration entry and stylesheets

- Source: comparison with common practice, 2026-11-11.
- What and why: `modulepreload` and stylesheet links reach the browser only with the shell, after loaders ran.
- Evidence: `packages/web/src/components/head.ts:72-79`.
- Acceptance: opt-in `web.earlyHints` sends `Link` preloads with a 103 before loaders run; specs; docs on proxy support.
- Status: open.

### T-054 [feature] Auth: bulk family work on "sign out everywhere"

- Source: security and performance audit of 2026-11-11.
- What and why: `revokeAllTokens` now ensures each family once, but still runs one transaction per family for ensure
  and revoke.
- Evidence: `packages/auth/src/services/auth.service.ts:971-990`.
- Acceptance: one upsert for missing families and one bulk update for revocation; events unchanged; specs.
- Status: open.

### T-055 [feature] Queue local drivers: indexes for large retention

- Source: security and performance audit of 2026-11-11.
- What and why: SQLite pruning sorts a state's rows by `json_extract(body, '$.finishedAt')` without an index; the
  memory store's polling is copy-free but still compares every kept job.
- Evidence: `packages/queue/src/drivers/sqlite-store.ts:143-144`; `packages/queue/src/drivers/memory-store.ts:56`.
- Acceptance: an expression index on `finishedAt`; a per-queue ready index in the memory store; specs.
- Status: open.

### T-056 [feature] `ai.session`: avoid the second full-record write per turn

- Source: security and performance audit of 2026-11-11.
- What and why: each turn saves the whole session record once to mark it pending and again to settle it.
- Evidence: `packages/ai/src/session/conversation-session.ts:183-202`.
- Acceptance: a store-level pending marker (snapshot store contract addition) so a turn writes the record once;
  crash recovery specs unchanged.
- Status: open.

### T-057 [feature] Scope and namespace filtering inside the vector store

- Source: security and performance audit of 2026-11-11.
- What and why: memory tiers, the semantic cache and RAG now widen similarity queries until enough in-scope hits pass
  (up to five queries on a crowded store). Filtering in the store needs a cache-driver capability that does not go
  through the per-write tag index and supports AND with caller tags.
- Evidence: `packages/ai/src/utils/similar-within.ts`; `packages/cache/src/tagged-cache.ts:79`;
  `packages/cache/src/drivers/pg-cache-driver.ts:197-225` (tag index as one JSON row rewritten per tagged write).
- Acceptance: drivers accept a scope/namespace filter on `similar()`; one query per recall; specs.
- Status: open.

### T-058 [chore] Workspace search: shorter synchronous slices

- Source: security and performance audit of 2026-11-11.
- What and why: one 2,000-character line against a pattern near the 4,000-state cap costs about half a second before
  the per-line budget check; a long wildcard glob over a directory of long names is seconds of synchronous work.
- Evidence: `packages/ai-workspace/src/ops.ts:117-120`, `:1162`; `packages/ai-workspace/src/policy/jail.ts:85`.
- Acceptance: a lower state cap or a step check inside a line; glob matching yields between entries; specs.
- Status: open.

### T-059 [chore] Core request-path leftovers

- Source: security and performance audit of 2026-11-11.
- What and why: (1) the refusal route is found by a scan per refusal; (2) middleware names are coloured before the
  logger decides whether the line is kept; (3) the rate limiter keeps one bucket set per limiter id in a module map that
  is never pruned (grows when middleware is built per request or across hot reloads).
- Evidence: `packages/core/src/router/router.ts:1492`; `packages/core/src/http/request.ts:1378`, `:1407`;
  `packages/core/src/http/middleware/rate-limit.middleware.ts:80`, `:192-196`.
- Acceptance: cached refusal route; lazy message building; limiter state held by the middleware closure (spec counter
  via a weak reference); specs.
- Status: open.

### T-060 [feature] Trace dashboard: conditional poll

- Source: security and performance audit of 2026-11-11.
- What and why: the dashboard polls `GET api/traces` and receives the full summary list each time.
- Evidence: `packages/ai-panoptic/src/dashboard/serve.ts:116-119`.
- Acceptance: `ETag` on the list and 304 on `If-None-Match`; the UI sends it; specs.
- Status: open.

### T-061 [feature] Multi-site resolver: shorter memory for unknown hosts

- Source: security and performance audit of 2026-11-11.
- What and why: `resolveHost` results, including `null`, are remembered for the full `ttl`, so a host added at runtime
  starts resolving only after that.
- Evidence: `packages/web/src/sites/site-selector.ts:29`, `:107`.
- Acceptance: optional `resolveCache.negativeTtl`; specs; docs.
- Status: open.

### T-062 [bug] MongoDB `withCount()` and `joinWith()` are silently ignored

- Source: security and performance audit of 2026-11-11.
- What and why: on MongoDB, `withCount()` records relations that the builder never reads (no count fields appear), and
  `joinWith()` records relations without adding any `$lookup`. Both succeed silently.
- Evidence: `packages/cascade/src/query-builder/query-builder.ts:140`, `:1163` (`withCount` records
  `countRelations`); `packages/cascade/src/drivers/mongodb/mongodb-query-builder.ts:2853-2885` (`joinWith` fills
  `joinRelations`, read nowhere else in the MongoDB driver).
- Acceptance: both implemented with `$lookup` (+ `$size` for counts) from the relation definitions, or both throw a
  clear "not supported on MongoDB" error; specs.
- Status: open.

### T-063 [bug] `cursorPaginate()` reads cursor values as model properties

- Source: security and performance audit of 2026-11-11.
- What and why: both drivers read the cursor column with `row[column]` from hydrated models. Model columns are not
  properties (only members such as `id` are), so any cursor column other than a model member yields `undefined`
  cursors.
- Evidence: `packages/cascade/src/drivers/mongodb/mongodb-query-builder.ts:2575`, `:2607-2608`;
  `packages/cascade/src/drivers/postgres/postgres-query-builder.ts:1345-1346`;
  `packages/cascade/src/model/methods/column-read-guard.ts:50-60`.
- Acceptance: cursors read through `model.get(column)` (or the raw row); spec paginating by `createdAt` on both
  drivers.
- Status: open.

### T-064 [bug] `findAndUpdate(..., { upsert: true })` updates only the first match

- Source: security and performance audit of 2026-11-11.
- What and why: with `upsert` the update goes through the upsert scoping, which pins the filter to one visible id, so
  several matching rows get only the first updated.
- Evidence: `packages/cascade/src/model/methods/query-methods.ts:485-489`, `:383-389`.
- Acceptance: all matching rows are updated; an insert happens only when none match; spec.
- Status: open.

### T-065 [feature] MongoDB `has()` / `whereHas()` family

- Source: security and performance audit of 2026-11-11.
- What and why: since 5.53.0 these throw on MongoDB instead of being dropped. Implementing them needs `$lookup` from
  the relation definitions, a decision for write paths (resolve ids first or keep refusing), and `orWhereHas` inside
  `$or`.
- Evidence: `packages/cascade/src/drivers/mongodb/mongodb-query-parser.ts:1239-1244`;
  `packages/cascade/src/drivers/postgres/postgres-query-builder.ts:1727` (`buildHasSubquery`, the reference).
- Acceptance: hasMany/hasOne/belongsTo/belongsToMany supported in reads and counts; writes resolve ids or refuse
  clearly; specs.
- Status: open.

### T-066 [feature] Query `cursor()` / `stream()` iterator

- Source: security and performance audit of 2026-11-11.
- What and why: `chunk()` now pages by key, but there is no async iterator; MongoDB `cursor()` throws.
- Evidence: `packages/cascade/src/drivers/mongodb/mongodb-query-builder.ts:1571-1575`;
  `packages/cascade/src/query-builder/keyset-chunk.ts`.
- Acceptance: `for await (const model of query.stream())` on both drivers, hydrating per batch; specs; docs.
- Status: open.

### T-067 [bug] Template: the users list filters on a column the model does not have

- Source: security and performance audit of 2026-11-11.
- What and why: the template's repository config sets `isActiveColumn: "status"` / `isActiveValue: "active"`, the
  users services call `listActiveCached` / `firstActiveCached`, and the `User` model has no `status` field, so the list
  and lookup filter on a column no row has.
- Evidence: `packages/create-warlock/templates/warlock/src/config/repository.ts:4-5`;
  `packages/create-warlock/templates/warlock/src/app/users/services/list-users.service.ts:6`, `:10`;
  `packages/create-warlock/templates/warlock/src/app/users/models/user/user.model.ts`.
- Acceptance: either the setting goes and the services use the plain helpers, or the model and migration gain
  `status`; a template spec lists a created user.
- Status: open.

### T-068 [bug] Docs: the pgvector store example cannot work

- Source: security and performance audit of 2026-11-11.
- What and why: the docs pass `ai.rag.pgVectorStore(...)` as `ai.rag({ store })`, but `store` must be a cache driver:
  `rag()` wraps it in `cacheVectorStore(driver)`, which calls `driver.set`/`driver.similar`, so the first `index()`
  fails.
- Evidence: `docs/src/content/docs/v/latest/ai/rag/rag-loaders-and-stores.md:159-166`;
  `packages/ai/src/rag/rag.ts:64-72`.
- Acceptance: `RagConfig.store` accepts a `VectorStore` (preferred), or the docs show the working setup; spec.
- Status: open.

### T-069 [bug] Scheduler: a throwing `job:*` listener leaves an unhandled rejection

- Source: security and performance audit of 2026-11-11.
- What and why: the run loop chains `void run.finally(...)`; when an event listener throws inside a run, the rejection
  is unhandled (same exposure as before 5.53.0).
- Evidence: `packages/scheduler/src/scheduler.ts:513-540`.
- Acceptance: listener errors are caught and logged; spec with a throwing listener and an `unhandledRejection` spy.
- Status: open.

### T-070 [bug] Workspace `grep`: case-insensitive classes miss some letters

- Source: security and performance audit of 2026-11-11.
- What and why: the linear matcher tries a code unit, its canonical form and its lower case, so an ignore-case class
  misses letters that share a canonical form through a third code unit (for example `µ` and `μ`).
- Evidence: `packages/ai-workspace/src/search/linear-regex.ts:137`, `:317`.
- Acceptance: case folding matches the built-in `RegExp` with the `i` flag; differential spec over such letters.
- Status: open.

### T-071 [chore] `Restful.list` answers 5xx outside the request funnel

- Source: security and performance audit of 2026-11-11.
- What and why: apart from refused filters, `Restful.list` catches every error and answers `response.serverError`,
  so the failure is not recorded once by the request funnel like other 5xx responses.
- Evidence: `packages/core/src/restful/restful.ts:99-106`.
- Acceptance: other errors are rethrown; the funnel answers and records them; existing restful specs updated.
- Status: open.

### T-072 [feature] App-wide date output default for resources

- Source: security and performance audit of 2026-11-11.
- What and why: each resource date field builds the full date object (several formats) unless the field calls
  `dateOptions()`; apps that only need ISO strings must repeat it per field.
- Evidence: `packages/core/src/resource/resource-field-builder.ts:60`, `:167`, `:246`.
- Acceptance: `resource.dateOutput` config default (for example `"iso"`), per-field options still win; specs; docs.
- Status: open.

### T-073 [chore] Stale documentation text

- Source: security and performance audit of 2026-11-11.
- What and why: (1) the dirty-tracking page says writing an equal value makes the field dirty; the tracker reports it
  clean; (2) the `ai.guardrail` doc comment lists the detector factories without `links`.
- Evidence: `docs/src/content/docs/v/latest/cascade/architecture-concepts/dirty-tracking.md:166-170`;
  `packages/ai/src/ai.ts:232-233`.
- Acceptance: both texts match the code.
- Status: open.

### T-074 [chore] Export the `ContextStorage` type

- Source: security and performance audit of 2026-11-11.
- What and why: a context's protected `storage` is now typed `ContextStorage`, which the package does not export, so
  subclasses cannot name it.
- Evidence: `packages/context/src/shared-storage.ts:25`; `packages/context/src/base-context.ts:81`.
- Acceptance: type exported from the barrel and named in the context skill (skill-coverage gate passes).
- Status: open.

### T-075 [chore] Stable codes for the deployment warnings of `warlock doctor`

- Source: security and performance audit of 2026-11-11.
- What and why: the nine deployment checks name the setting to change but carry no `WL` code, unlike other doctor
  results.
- Evidence: `packages/core/src/cli/commands/doctor/checks/index.ts:1-62`; `packages/core/src/errors/error-codes.ts`.
- Acceptance: one code per check, listed on the error-codes docs page; specs updated.
- Status: open.

### T-076 [chore] Failure-path `Vary` header misses the new tokens

- Source: security and performance audit of 2026-11-11.
- What and why: page failures still send the older `Vary` (no `Cookie, locale` or `cache.varyHeaders`). Harmless
  while those responses are `no-store`, but inconsistent.
- Evidence: `packages/web/src/server/page-route-handler/write-page-failure-response.ts:87-91`.
- Acceptance: the failure path passes the same inputs as the normal path; spec.
- Status: open.

### T-077 [chore] Dev server host refusal points at the wrong setting

- Source: security and performance audit of 2026-11-11.
- What and why: a host refused by the dev server gets the bundler's own message telling the user to edit
  `server.allowedHosts` in a bundler config file; in a Warlock app the setting is `web.devAllowedHosts`.
- Evidence: `packages/web/src/vite/dev-server-config.ts:550-576`.
- Acceptance: the refusal names `web.devAllowedHosts` (a pre-middleware with the same host check, or a rewritten
  403 body); spec.
- Status: open.

### T-100 [bug] `warlock generate.typings` reported to hang on Windows

- Source: application upgrade report of 2026-11-12 (Windows 11, Node 24.15.0); the same report says it happened before
  and after 5.53.
- What and why: on Windows, the package scripts that run `warlock generate.typings` (the typecheck and the build) stop
  at that step. The team typechecks with `tsc --noEmit` directly and builds without the step. No further detail came
  with the report. Not confirmed from the source: the command does not reach the supervisor code fixed in 5.53.1
  (T-095). It runs `filesOrchestrator.initializeAll()`, `typeGenerator.generateAll()` and the connectors' typings
  (which fork the route-registration child and run web's `build.typings` hook). The scaffolded `recover()` call runs
  only in `Application.onValidateBoot`, which `generate.typings` never runs. Every step on the path is bounded or
  shared with paths that work on the reporting machine (`warlock build` and `warlock dev`), and a successful run ends
  through `exitAfterFlush(0)`, so a lingering handle cannot keep it open.
- Evidence: `packages/core/src/cli/commands/typings-generator.command.ts:30-52` (the action);
  `packages/core/src/production/registration-child-runner.ts:108-124,153-156` (timeout and restart on progress);
  `packages/core/src/cli/cli-commands.manager.ts:52,326` (`exitAfterFlush`);
  `packages/web/src/build/contribution.ts:382-411` (web's `typings` hook);
  `packages/web/src/build/load-web-build-config.ts:70` (`loadWebBuildConfig`);
  `packages/core/src/dev-server/type-generator.ts:51` (`listRouteLocaleKeysForTypeGeneration`);
  `packages/core/src/generations/features/process.feature.ts:27` (the scaffolded `recover()` call).
- Candidate causes, most likely first:
  1. The registration child is slow and the command prints nothing while it waits. The same app needed a 180-second
     limit for route registration (T-098), the limit now restarts on every module, so with a raised limit the total
     time is unbounded, and the child's output is shown only on failure. A run of several minutes with no output reads
     as a hang.
  2. Web's `build.typings` hook, which only `generate.typings` runs. `loadWebBuildConfig()` bundles `src/config/web.ts`
     with its app imports and imports the result in the CLI process; app code that runs at import (a database or cache
     client, a top-level await) can block it there. `warlock build` loads it too, so this ranks lower.
  3. `listRouteLocaleKeysForTypeGeneration()` imports `@warlock.js/web/build` into the CLI process. `warlock dev`
     does the same, so it is the least likely.
- How to settle it on a Windows machine, in the app:
  - Watch which files change. `generateAll` writes `.warlock/typings/*.d.ts`; web's hook writes
    `.warlock/typings/web-routes.d.ts` last. If the first group updates and the last never does, the hang is in the
    connector step. In Task Manager, a second `node.exe` child with CPU time still moving means the registration child is
    still importing (candidate 1).
  - Run `set WARLOCK_ROUTE_REGISTRATION_TIMEOUT_MS=30000` and then `npx warlock generate.typings`. A timeout error that
    names a module confirms candidate 1.
  - Run `node --inspect node_modules/@warlock.js/core/bin/warlock.js generate.typings`, attach the Chrome DevTools
    inspector, pause after a minute and read the stack. Or preload
    `--import data:text/javascript,setInterval(()=>console.error(Date.now(),process.getActiveResourcesInfo()),10000)`
    to print what the process is waiting on: a `ChildProcess` or `Pipe` points to candidate 1, a `TCPWrap` points to
    app code in candidate 2.
- Acceptance: the cause is identified on a Windows machine and either fixed with a spec (or, for candidate 1, the
  command prints progress and the child's output while it waits), or closed as an app-side import.
- Status: open. Not confirmed from the source; no code changed in 5.53.1.
- Owner decision: none; needs someone with a Windows machine to run the steps above.

### T-101 [bug] `fallbackModel({ retryOn })` replaces the default failover codes; docs call it additive

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: both forms of `retryOn` (a code list and a predicate) replace the built-in set instead of adding to
  it. `ai.fallbackModel([a, b], { retryOn: (error) => error instanceof MyError })` stops failing over on rate limits,
  overloaded, timeout and 5xx provider errors, so `b` is never tried when `a` is down. The type comment and the recipe
  page say both forms are "additive over the default", and the default set is not exported, so an app cannot compose
  with it and has to copy the list (it already grew once, with `PROVIDER_OVERLOADED` in 5.53.0). The type comment also
  lists the default without `PROVIDER_OVERLOADED`, and the resilience page contradicts itself ("widening `retryOn`").
- Evidence: `packages/ai/src/model/fallback-model.ts:95-104` (`resolveShouldRetry`: a function is returned as is, a
  list replaces `DEFAULT_RETRYABLE_CODES`); `:29-34` (the default, module-private, not exported from
  `packages/ai/src/model/index.ts`); `:207` and `:263` (the gate `isLast || !this.shouldRetry(error)`);
  `packages/ai/src/contracts/fallback-model.contract.ts:19-23` ("additive") and `:29` (default list without
  `PROVIDER_OVERLOADED`); `docs/src/content/docs/v/latest/ai/recipes/cost-provider-fallback.md:96` ("additive over
  the default"); `docs/src/content/docs/v/latest/ai/best-practices/resilience.md:165` and `:359`;
  `packages/ai/skills/ai-dx-helpers/SKILL.md:106-107` (both forms shown, replacement never stated).
- Workaround: write the default set in the app and combine it with the extra reason:
  `retryOn: (e) => (e instanceof AIError && ["PROVIDER_RATE_LIMIT", "PROVIDER_OVERLOADED", "PROVIDER_TIMEOUT", "PROVIDER_ERROR"].includes(e.code)) || isMyReason(e)`.
  The list must be kept in step by hand.
- Smallest fix: export the default set (or a `defaultFallbackRetryOn(error)` predicate) from the model barrel; say
  "replaces" in the contract comment, the recipe and the skill, and add `PROVIDER_OVERLOADED` to the comment's list.
  Optionally accept an additive form (`retryOn: { also: fn }`).
- Acceptance: the default is importable from `@warlock.js/ai`; a spec shows a predicate and a list each replace the
  default and that composing with the exported default keeps the standard failover; the contract comment, recipe,
  resilience page and `ai-dx-helpers` skill say "replaces" and name the export; `packages/ai/CHANGELOG.md` entry
  (skill-coverage gate passes for the new export).
- Status: open.

### T-102 [bug] A caller's own abort starts the fallback chain

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: when the caller aborts a call, the OpenAI and Anthropic adapters reject with a plain `ProviderError`
  (`PROVIDER_ERROR`, which is in the default failover set) because neither mapper recognises the SDK's user-abort
  error. `fallbackModel` records it in `lastAttempts` and calls the next model with the same already-aborted signal.
  Adapters that honour the signal contract then fail at once, so the visible damage is a spurious attempt and a final
  error that comes from the backup model instead of the abort; an adapter or mock that ignores the signal makes a real
  wasted call. `retryModel` already stops on a cancel (`isAbortError` or `category === "cancelled"`); `fallbackModel`
  has no equivalent and the adapters never mark the abort as cancelled.
- Evidence: `packages/ai/src/model/fallback-model.ts:207` and `:263` (no look at `options.signal`);
  `packages/ai/src/model/retry-model.ts:141` (the cancel check `fallbackModel` lacks);
  `packages/ai-openai/src/utils/wrap-openai-error.ts:111` and `packages/ai-anthropic/src/utils/wrap-anthropic-error.ts:108`
  (the abort falls through to `new ProviderError`); `packages/ai-openai/src/model.ts:175`, `:268`;
  `packages/ai-anthropic/src/model.ts:1349`; `packages/ai-openai/src/responses-model.spec.ts:1474-1507` (pins the
  `ProviderError` result for an aborted stream, `cause` an `APIUserAbortError`).
- Workaround: build the `fallbackModel` per request and close over that request's signal in `retryOn` (re-adding the
  default codes, see T-101): `retryOn: (e) => !signal.aborted && isDefaultFailover(e)`. A shared long-lived chain
  cannot do this because the predicate does not receive the call options.
- Smallest fix: in `FallbackRun.complete` and `FallbackRun.stream`, rethrow when `options?.signal?.aborted` before
  consulting `shouldRetry`; in both adapter mappers, detect the SDK's user-abort error and return an error with
  `category: "cancelled"` carrying the `AbortError` name.
- Acceptance: a spec aborts the first model mid-call and shows one attempt, no second call, and the abort error
  surfacing; adapter specs map the SDK abort to the cancelled category; the spec at `responses-model.spec.ts:1474-1507`
  is updated; `retryModel` and workflow retry still stop on it; changelog entries in `@warlock.js/ai`,
  `@warlock.js/ai-openai`, `@warlock.js/ai-anthropic`.
- Status: open.

### T-103 [bug] OpenAI quota exhaustion on a 429 is mapped to a retryable rate limit

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the OpenAI error mapper treats only `code === "insufficient_quota"` as spent credit. A 429 whose body
  has `type: "insufficient_quota"` but another `code` (for example `credit_balance_exhausted`) falls through to the
  status-429 branch and becomes `ProviderRateLimitError`, which is retryable. `retryModel` and workflow retry then
  repeat a call that cannot succeed, and the error no longer says the account is out of credit. `billing_hard_limit_reached`
  is never `QuotaExceededError` (a 400 gives `InvalidRequestError`, a 429 gives the rate-limit error). `type` is read
  and stored in `error.context.type` but never used for the decision. The Anthropic mapper already decides on
  `type === "billing_error"` before the 429 branch.
- Evidence: `packages/ai-openai/src/utils/wrap-openai-error.ts:71-73` (quota branch on `code` only), `:75-81` (429
  branch); `packages/ai-anthropic/src/utils/wrap-anthropic-error.ts:78-80` (the type-based check, before the 429
  branch); `packages/ai-openai/src/utils/wrap-openai-error.spec.ts:101-112` (only `status: 429, code: "insufficient_quota"`
  is covered); `packages/ai/src/errors/quota-exceeded-error.ts:8` (documented as not retryable).
- Workaround: read `error.context.type` / `error.context.code` in the app's own `retryOn` predicate and treat
  `insufficient_quota` as fatal. The class and the `retryable` flag stay wrong for framework-level retry.
- Smallest fix: before the 429 branch, map to `QuotaExceededError` when `shape.code === "insufficient_quota"`,
  `shape.type === "insufficient_quota"` or the code is one of `credit_balance_exhausted`, `billing_hard_limit_reached`,
  `billing_not_active`.
- Acceptance: specs for a 429 with `type: "insufficient_quota"` and another code, and for `billing_hard_limit_reached`
  on 400 and 429, all giving `QuotaExceededError`; the existing rate-limit cases still give `ProviderRateLimitError`;
  `packages/ai-openai/CHANGELOG.md` entry. Whether the default fallback chain should advance on exhausted credit stays
  as today (`PROVIDER_QUOTA_EXCEEDED` is not in the default set); note it in the changelog.
- Status: open.

### T-104 [bug] `config.translations` is rejected by the page-module key list

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the `translations` declaration is typed (`PageConfig`, `LayoutConfig`, `RootConfig`), documented in
  the localization page and the `localize-pages` skill, and read by the translation analyzer, but the module-config
  reader's allow-list has no `translations` key for a page, layout or root. A page file or its `*.setup.ts` with
  `export const config = { route: "/x", translations: ["a.*"] }` fails discovery with
  ``config key `translations` is not allowed in a page module``. The only spec that uses a setup-file declaration
  calls the analyzer directly, so nothing caught the mismatch.
- Evidence: `packages/web/src/module-config-schema.ts:14-37` (`MODULE_CONFIG_KEYS`, no `translations`);
  `packages/web/src/build/read-module-config.ts:54-58`, `:236-239` (the thrown message);
  `packages/web/src/build/discover-pages.ts:773`, `:800-810` (page file and setup companion both checked);
  `packages/web/src/page-config.ts:94`, `:121`, `:144` (the type accepts it);
  `packages/core/src/localization/translation-usage-graph.ts:65-74`, `:118-130` and
  `packages/web/src/build/translation-manifest.ts:143-148` (the analyzer accepts it);
  `packages/web/skills/localize-pages/SKILL.md:59-70`; `docs/src/content/docs/v/latest/web/essentials/09-localization.mdx:309`,
  `:324`.
- Workaround: list dynamically read keys as key-shaped string literals in a constant inside a component the page
  imports (a literal ending in a dot is a prefix); or set `build.translations.prune: false` to ship every group.
- Smallest fix: add `"translations"` to the page, layout and root lists in `MODULE_CONFIG_KEYS`.
- Acceptance: `read-module-config.spec.ts` reads a page, a layout and a root setup file with the array form and the
  `{ keys, exhaustive }` form; a discovery-level spec shows the declared keys reach the manifest; `packages/web/CHANGELOG.md`
  entry.
- Status: open.

### T-105 [bug] Development and test servers drop a route's `serverOptions.config` without a warning

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the production scan merges `route.serverOptions.config` into each route's Fastify config. The
  development scan registers one wildcard route per verb with `config: { rateLimit: false }` only, so the route's
  config never reaches Fastify plugins that read it, for example `multipartOptions` (a per-route file-size limit).
  Under `warlock dev` and the HTTP test server started by the test global setup (both use the development scan), a
  route that raises its per-file limit this way gets 413 from the global `http.fileUploadLimit` while the production
  build accepts the file. The dev refusal list of unsupported options does not include `config`, so no boot warning
  appears, and the `serverOptions` doc comment does not list it among the options not applied in dev.
  The in-process helpers (`createTestHttpServer`, the integration harness) use the production scan and are not affected.
  The route-level `uploads: { maxTotalSize }` option works in dev; it covers only the total size, not per-file, file
  count or field limits.
- Evidence: `packages/core/src/router/router.ts:1213-1224` (production merge), `:1249` (`scanDevServer`), `:1431`
  (dev config); `packages/core/src/router/dev-body-limit.ts:148-162` (`UNSUPPORTED_DEV_SERVER_OPTIONS`, no `config`);
  `packages/core/src/router/types.ts:232-264` (doc comment); `packages/core/src/connectors/http-connector.ts:195-199`
  (dev scan chosen for the development runtime); `packages/core/src/tests/start-http-development-server.ts`;
  `docs/src/content/docs/v/latest/core/testing/integration-tests.md:332`; `packages/core/src/http/multipart.ts:82-97`
  (plugin limits set once from `http.fileUploadLimit` and `http.multipart.*`).
- Workaround: raise `http.fileUploadLimit` globally for development and enforce the stricter per-route size in the
  schema (`v.file().size(...)`); use `uploads: { maxTotalSize }` for the total.
- Smallest fix: add `config` to `UNSUPPORTED_DEV_SERVER_OPTIONS` (one warning per route) and name it in the doc comment;
  better, extend `uploads` with per-file size and count limits and apply them in the dev dispatcher too.
- Acceptance: a spec in `dev-body-limit.spec.ts` shows the warning for a route with `serverOptions.config`; the
  `serverOptions` doc comment, the routing page and the integration-test page list it (or, if the option is
  implemented, a spec shows a per-route per-file limit working under the dev dispatcher); changelog entry.
- Status: open.

### T-106 [bug] The error-response hook and the refusal dispatcher have no guard for a reply already sent

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: with `http.errorResponse` set, a refused browser request on a page host (for example a path-traversal
  `GET` with `Accept: text/html`) was reported to end in `ERR_HTTP_HEADERS_SENT`. The mechanism could not be
  reproduced: the HTML refusal reply is not JSON, so the formatter returns it untouched, and returning `reply` from
  the route error handler is safe. What the code does show is a missing guard in two places: the `onSend` formatter
  never checks `reply.sent`, `reply.raw.headersSent` or `writableEnded`, and `Router.dispatchRefusal` decides "nothing
  was sent" from `reply.sent` alone, which stays `false` while an async `onSend` hook is pending. A throw after
  `response.html()` has been called is then treated as unsent, and the caller sends a second reply through the root
  error handler. No spec combines `http.errorResponse` with a refusal; the specs for each side use a bare Fastify.
- Evidence: `packages/core/src/http/error-response.ts:39-48` (hook, no sent check);
  `packages/core/src/router/router.ts:1481-1510` (`dispatchRefusal`, the `catch` at `:1499-1504`);
  `packages/core/src/http/lazy-static.ts:244-260` (the error handler that calls it);
  `packages/web/src/server/core-refusal-page.ts:48-71` (writes the page); `packages/core/src/http/error-response.integration.spec.ts`,
  `packages/core/src/router/refusal-route.spec.ts`, `packages/core/src/http/refusal-dispatch.spec.ts` (each one side only).
- Workaround: none needed if it does not reproduce; if it does, serve the JSON refusal (the formatter then formats it)
  by not registering a page that handles refusals.
- Smallest fix: return the payload at the top of the hook when `reply.sent || reply.raw.headersSent || reply.raw.writableEnded`;
  in `dispatchRefusal`'s catch test `fastifyReply.sent || fastifyReply.raw.headersSent`.
- Acceptance: an integration spec over a real socket (a bare `inject` normalises dot segments away) with
  `Accept: text/html`, `http.errorResponse` set and a refusal-handling route registered, answering 403 once with the
  page body; a spec for each guard; changelog entry. If the reported error still occurs on 5.53.1, capture the first
  stack frame and update this entry before fixing.
- Status: open. The reported mechanism is not confirmed; the guards are defensive.

### T-107 [bug] Refusal pages render without layout and root, without the URL locale, and without a request id

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: since 5.39.0 a refused browser request (403/400 from core, such as a traversal path) gets the site's
  `forbidden`/`error` page instead of raw JSON. That page is rendered through the failure renderer, outside the page
  pipeline: it is wrapped in the default app only, so the app's root and the nearest layouts (header, footer) are
  missing; the locale comes from core's lazy resolution (query, cookies, header, default) and ignores the URL prefix, so
  `/ar/...` is answered in the default locale (the not-found path pins the prefix locale, the refusal branch returns
  before that); and the request id reaches the visitor only on the last-resort boundary, not on a site error page
  (a refusal is a visitor-safe 4xx, so no id is carried in the props).
- Evidence: `packages/web/src/server/core-refusal-page.ts:44-75`; `packages/web/src/server/render-page.ts:1770` (`renderPageFailure`),
  `:1840-1856` and `:1870-1877` (default app only; the id only on the framework boundary); `packages/web/src/server/not-found-page.ts:350-397`
  (refusal branch) and `:426-432` (prefix locale pinned only afterwards); `packages/web/src/server/error-page.ts:131-138`
  (id carried only for non-visitor-safe errors).
- Workaround: make the site's `forbidden.page.tsx` / `error.page.tsx` render its own shell and read the locale with
  `useLocale()`. There is no public way to put the request id into that page for a 4xx.
- Smallest fix: pin the URL-prefix locale in the refusal branch (reuse the not-found code), carry `request.id` in the
  serialized props for 4xx failures, and render the failure through the root and the nearest layouts when they load.
- Acceptance: specs for a refusal on a prefixed URL (locale from the prefix), a site with a layout (layout markup
  present around the forbidden page) and a site error page (request id available to the page); docs for
  special pages and the `localize-pages`/special-pages skill say what a refusal page receives; changelog entry.
- Status: open.

### T-108 [bug] A noindex 404 page still emits `hreflang` alternates

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the not-found page is rendered with `robots: noindex`, and `enrichMetadata` already skips canonical,
  `og:url` and `og:locale` for a noindex page. The locale alternates are computed separately, without looking at
  `robots`, so with prefix locale routing a request to `/en/missing` answers 404 with `<meta name="robots" content="noindex">`
  and `<link rel="alternate" hreflang="en|ar|x-default">` pointing at non-existent URLs. A page that sets `robots: "noindex"`
  itself does the same. Search engines are told a page is not to be indexed and also that it has translations.
- Evidence: `packages/web/src/server/render-page.ts:1301-1303` (noindex set), `:1313-1318` (alternates computed
  without the robots value), `:1343-1345` (an empty `metadata.alternates` does not suppress the generated set);
  `packages/web/src/metadata/enrich-metadata.ts:53-65` (`isNoindex`, not exported, gates only the metadata path);
  `packages/web/src/components/head.ts:98-105` (renders one link per alternate);
  `packages/web/src/server/resolve-locale-alternates.ts:95-125` (gates on strategy, origin and codes only).
- Workaround: none short of locale strategy `none`, which removes hreflang everywhere.
- Smallest fix: export `isNoindex` and pass no alternates when the resolved `robots` is noindex.
- Acceptance: a spec renders the not-found page and a page with `robots: "noindex"` under prefix routing and finds no
  `hreflang` link, while an indexable page keeps them (`render-page-metadata-alternates.spec.ts`); the metadata page and
  `set-page-metadata` skill state it; changelog entry.
- Status: open.

### T-109 [bug] Docs and skill describe a request-locale order the code does not use

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: several pages say the locale is read first from a `translation-locale-code` header, then the `locale`
  header, then `?locale=`, then the default, and show a getter that reads that header. No source file reads
  `translation-locale-code`. The real order in `Request.resolveLocale` is: `?locale=` query, the `warlock.locale-preference`
  cookie (only when it is in `app.localeCodes`), the `locale` cookie, the `locale` header, then `app.localeCode`
  (a value outside a declared `app.localeCodes` falls back to the default). Cookies are not mentioned in any of these
  pages. An app that follows the docs and sends the documented header gets no effect. (Whether the order itself should
  change is T-111.)
- Evidence: `packages/core/src/http/request.ts:508-529` (the real order); stale text in
  `docs/src/content/docs/v/latest/core/the-basics/http-request.md:346-350`,
  `docs/src/content/docs/v/latest/core/the-basics/localization.md:30-79`, `:283`, `:294`, `:336`,
  `docs/src/content/docs/v/latest/core/upgrade-to-v5.mdx:212`, `docs/src/content/docs/v/latest/core/recipes/localized-responses.md:51-54`
  (omits cookies and the preference cookie), `packages/core/skills/use-localization/SKILL.md:170-175`.
- Workaround: follow the order in `resolveLocale`, not the pages; to force a locale, send `?locale=<code>` or call
  `request.setLocaleCode(...)` early.
- Smallest fix: rewrite each passage to the five-step order above (or, if T-111 changes the order, to the new one),
  remove the `translation-locale-code` header and the getter listing, and state the `app.localeCodes` allow-list.
- Acceptance: the pages and the skill agree with `resolveLocale`; no remaining mention of `translation-locale-code`
  outside a changelog; a spec pins the order (query, preference cookie, locale cookie, header, default) so the docs
  cannot drift again; core changelog entry under documentation.
- Status: open.

### T-110 [bug] The `http.bodyLimit` type comment still says the default is 200 GB

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the doc comment editors show on hover for `http.bodyLimit` says `@default 200 * 1024 * 1024 * 1024`
  ("200GB, historical default") and points per-route limits at the `maxBodySize()` middleware. The server passes
  `bodyLimit` to Fastify only when configured, so an unconfigured app gets Fastify's own 1 MiB (the dev dispatcher uses
  the same fallback), and per-route limits belong to `serverOptions.bodyLimit` (`maxBodySize()` runs after parsing and
  does not bound chunked bodies). The docs pages and the scaffold are already right.
- Evidence: `packages/core/src/http/types.ts:415-425` (comment); `packages/core/src/http/server.ts:91`, `:116-119`
  (the real behaviour); `packages/core/src/router/router.ts:1314` (dev fallback);
  `docs/src/content/docs/v/latest/core/digging-deeper/security.md:378` (correct).
- Workaround: set `bodyLimit` explicitly in `src/config/http.ts` and ignore the hover text.
- Smallest fix: change the comment to "@default Fastify's own 1 MiB (1048576)" and point per-route limits at
  `serverOptions.bodyLimit`.
- Acceptance: the comment matches the runtime; `packages/core/CHANGELOG.md` entry; the docs-text gate passes.
- Status: open.

### T-111 [decision] Request locale order: a stale `locale` cookie wins over an explicit `locale` header

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the locale is resolved as query, preference cookie, `locale` cookie, `locale` header, default. A client
  that keeps a cookie jar and also sends a `locale` header (a native app on an HTTP client) gets the cookie's locale:
  `Cookie: locale=en` with `locale: ar` and `app.localeCodes: ["en","ar"]` gives `request.locale === "en"`. The cookie is
  server-persisted state; the header is an explicit per-request signal. No setting changes the order.
- Evidence: `packages/core/src/http/request.ts:508-529` (`resolveLocale`), `:534` (cached getter), `:543-552`
  (`setLocaleCode`); `packages/core/src/config/locale-configuration.ts:10` (cookie name);
  `packages/web/src/locale-preference.ts`; `packages/web/src/server/page-route-handler/persist-requested-locale.ts`
  (reads `request.locale`, no order of its own).
- Options: (a) move the `locale` header before the `locale` cookie (the preference cookie stays ahead of both, or goes
  after the header too, to decide); (b) keep the order and add `http.locale.sources`, an ordered list the app sets;
  (c) keep as is and only document it (T-109).
- Recommendation: (a) for the `locale` cookie vs `locale` header pair, with an upgrade note; it changes behaviour only
  for requests that send both with different values. Add (b) later only if an app needs another order.
- Acceptance: the chosen order ships with a spec pinning every pair, the corrected pages from T-109, a skill update and
  a changelog upgrade note.
- Status: open.
- Owner decision: which option, and whether the preference cookie also moves behind the header.

### T-112 [decision] `request.validated()` returns `{}` on a route with no schema

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: `validated()` returns the validated data when validation ran, otherwise an empty object, with no log
  and no error. A webhook handler that calls `request.validated()` on a route without a schema sees `{}` for a real JSON
  body and gets no signal that the schema is missing. The behaviour is documented ("returns `{}`"), so this is a choice,
  not a defect.
- Evidence: `packages/core/src/http/request.ts:1308-1319`; `packages/core/src/validation/validateAll.ts:187-188` (the
  only place the data is set); `docs/src/content/docs/v/latest/core/the-basics/http-request.md:88`.
- Options: (a) keep, no change; (b) log one development warning per route when `validated()` is called on a route
  with no schema, and return `{}` as today; (c) throw in development and test, return `{}` in production; (d) add a
  strict variant (`request.validatedOrFail()`) and leave `validated()` alone.
- Recommendation: (b): it catches the mistake early without breaking handlers that rely on `{}` (for example optional
  validation). Document `input()` / `all()` as the reads for schema-less routes.
- Acceptance: the chosen behaviour with a spec (warning once per route, none when a schema exists), the docs line
  updated, changelog entry.
- Status: open.
- Owner decision: which option.

### T-113 [decision] `web.robots` is one policy for every site

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: `web.robots` holds one set of groups and extra lines, served unchanged for every host. Only the
  `Sitemap:` line and the "dynamic site that is not indexable" answer vary per site. Two fixed sites that need different
  crawl rules (one with `Disallow: /admin`, the other open) cannot be expressed; a hand-written `public/robots.txt` is
  also one file for all hosts and makes web register no route.
- Evidence: `packages/web/src/configurations.ts:62` (`robots?: RobotsConfig`);
  `packages/web/src/sitemap/robots-config-types.ts:17-26` (`enabled`, `referenceSitemap`, `groups`, `extra`);
  `packages/web/src/sites/site-config.types.ts` (no `robots` key); `packages/web/src/sitemap/register-robots-route.ts:57-81`
  (config read once, same groups for every host; per-site only the sitemap URL and the non-indexable answer).
- Options: (a) keep one policy and document the app-route workaround; (b) accept `robots` under each site in `sites`
  (and in `resolveHost` results) and merge it over `web.robots` inside the `/robots.txt` handler; (c) accept a
  function `robots(site)` returning a `RobotsConfig`.
- Workaround today: leave `web.robots.enabled` false and register an app route `GET /robots.txt` that switches on the
  request host or `request.site` (not tested).
- Recommendation: (b): the site is already selected in that handler, and the merge is small.
- Acceptance: the chosen shape with specs (two sites, different groups; a site without `robots` gets the global one),
  docs on sites and sitemap/robots, the `generate-sitemap` skill and a changelog entry.
- Status: open.
- Owner decision: which option.

### T-114 [decision] Unknown API routes answer a fixed English body with no error code

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: a request that matches no route and does not ask for HTML gets
  `{"error":"Route not found","path":"...","method":"GET"}` with status 404 (also in multi-site mode, where the status
  is the refusal status when there is one). The body is a literal in the catch-all: no error code, no translated
  message, no request id, and `web.errors` / `http.errorMapper` are not consulted. An API client that switches on error
  codes cannot tell it from other 404s, and an app with its own error shape gets a second shape for this one case. The
  response event cannot change the body.
- Evidence: `packages/web/src/server/not-found-page.ts:414-424` (and `classifyUnmatchedRequest` at `:201`);
  `packages/web/src/server/site-dispatch.ts:198-200`, `:217-219`; `packages/core/src/http/response.ts:622-624`;
  `packages/web/src/server/not-found-page.ts:85` (the catch-all is the last route, so an app `/api/*` catch-all route
  would win, not tested).
- Options: (a) keep the shape for compatibility and document the workaround; (b) send the shape the rest of the API
  uses (a code such as `route_not_found`, a message through `request.t`, the request id) from one shared helper used by
  all three sites, keeping `path` and `method`; (c) route it through `http.errorMapper` so the app owns the shape.
- Recommendation: (b), and (c) later if apps need to replace it entirely. Keep `error` as the human message so existing
  clients that read it keep working; add `code` and `requestId` as new fields.
- Acceptance: the chosen body from one helper at all three sites; specs in single-site and multi-site mode, with a
  translated message per locale; docs and changelog (upgrade note if `error` text changes).
- Status: open.
- Owner decision: which option.

### T-115 [chore] Three defects live in the libraries the web package depends on

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: three behaviours reported against the framework are in dependencies and are fixed in those libraries'
  own repositories, not here. Installed versions: `@mongez/localization` 3.5.1 and `@mongez/react-form` 4.0.0. Keep this
  entry until the fixed versions are released and the framework's ranges are raised.
  1. Placeholder names swallow a following hyphen (localization): the colon pattern is `/:([a-zA-Z0-9_-]+)/g`, so
     `:minutes-min` is one placeholder named `minutes-min`, no value is found, and the template is left unchanged (`_x`
     joins too). Workaround: avoid `-` or `_` right after a placeholder (`":minutes min"`), pass the joined name as the
     key (`{ "minutes-min": 5 }`), or set `setLocalizationConfigurations({ placeholderPattern: "doubleCurly" })`, which
     switches every colon message in the process (framework messages included), or a custom pattern such as
     `/:([a-zA-Z0-9_]+)/g` (loses hyphenated names). Files: `esm/placeholder-pattern-config.mjs:2-8`, `esm/converters.mjs:5-11`
     in the installed package.
  2. Plural fallback order (localization, global-registry path): for a count the library tries the current locale's
     specific variant, then the fallback locale's specific variant, then the current locale's `_other`. A locale that
     defines only `_other` shows the fallback locale's `_one` text for count 1. Route dictionaries (`transFromKeywords`,
     used by `useTrans` and the request route translations) have no fallback locale and are not affected.
     Workaround: define every variant the locale's rules can select in each locale (Arabic: `_zero`, `_one`, `_two`,
     `_few`, `_many`, `_other`), or use route dictionaries. File: `esm/translator.mjs:156-181`. Framework call sites:
     `packages/web/src/localization.tsx:105-117`, `:136-144`; `packages/web/src/server/request-route-translations.ts:19-30`.
  3. Form control ids collide across forms (react-form): the default id is `input-<name>` and the error id
     `input-<name>-error`, derived from the field name only, so two forms on one page with a field `email` duplicate the
     ids (broken `label for`, `aria-describedby`, anchors); a nameless control uses a random id that differs between
     server and client. Workaround: pass an explicit `id` per control (for example from a per-form `useId()`); the error
     id follows. Files: `esm/hooks/form-hooks.mjs:12-18`, `esm/hooks/useFormControl.mjs:43-47`.
- Evidence: the files above under `node_modules/.pnpm/@mongez+localization@3.5.1/node_modules/@mongez/localization/`
  and `node_modules/.pnpm/@mongez+react-form@4.0.0_react@19.2.8/node_modules/@mongez/react-form/`.
- Acceptance: once the libraries release fixes, raise the dependency ranges, remove the workarounds from the docs and
  skills that mention them, and add a changelog line; until then the docs for placeholders, plurals and form ids should
  name the workaround above.
- Status: open (waiting on the libraries).
