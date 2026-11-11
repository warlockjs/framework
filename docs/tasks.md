# Open tasks

Open work for the framework repository. Finished entries move to `tasks.completed.md` (newest first).

## Owner decisions waiting

- T-007: coding-CLI adapters: change the `inheritEnv` default from inheriting everything to `"curated"`?
- T-008: release workflow: provenance / trusted publishing, a separate unprivileged gate job, write token out of the test step?
- T-009: next-major default flips (passkey user verification, login `emailLock`, multipart `routes`, `ai.serve` auth, short JWT secrets, JSON-lines file logs).
- T-010: encryption-key and JWT-secret rotation (previous keys accepted for reading): build it, and in which shape?
- T-011: model-level protected columns against mass assignment: which design?
- T-033: should `CapturedMessage.content` become text-only for multipart messages?

## Tasks

Ordered by value: security first, then performance, then features and bugs. Line numbers are as of 5.53.0.

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
