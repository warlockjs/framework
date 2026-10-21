# Warlock.js framework issue handoff — 5.34.3 review

Review date: **2026-10-21**. Target: `@warlock.js/*` **5.34.3** and
`@mongez/react-form` **4.0.0**.

This application-independent report preserves fifteen earlier findings, updates
their status against published package contents, and supplies generic
reproduction recipes and acceptance criteria. Stable report IDs are retained
for existing references; they are not upstream issue numbers.

## Evidence and interpretation

Original observations were recorded on framework 5.30.0/5.31.0, on Windows 11,
Node 24.15.0, pnpm 10.14.0, and TypeScript 5.9.3, with PostgreSQL where needed.
This review inspected extracted npm artifacts for Core, Web, Auth, and Cascade
5.34.3, their changelogs and relevant skills, and the installed Mongez form
4.0.0 implementation. The consumer application was not upgraded.

- **Source finding remains:** the problematic path is present in the reviewed
  source. This is not a fresh end-to-end reproduction on 5.34.3.
- **Needs reproduction:** a prior report remains useful, but this review does
  not establish whether it reproduces on 5.34.3. Changelog silence is not proof.
- **Capability addressed:** a supported public API now meets the original
  request; default response behavior need not have changed.

No fresh browser, database, scaffold, HMR, or HTTP-server reproduction suite
was run. No 5.34.3 `warlock doctor` output is attached because no upgraded
application was booted. Upstream duplicate searches and public issue filing
were not performed. The recipes below are maintainer reproduction targets,
not claims that complete standalone fixtures have already been executed.

Paths below are relative to the named package root. Immutable review inputs:
[Core 5.34.3 archive](https://registry.npmjs.org/@warlock.js/core/-/core-5.34.3.tgz),
[Web 5.34.3 archive](https://registry.npmjs.org/@warlock.js/web/-/web-5.34.3.tgz),
[Auth 5.34.3 archive](https://registry.npmjs.org/@warlock.js/auth/-/auth-5.34.3.tgz),
[Cascade 5.34.3 archive](https://registry.npmjs.org/@warlock.js/cascade/-/cascade-5.34.3.tgz).
The form dependency is [Mongez form 4.0.0](https://www.npmjs.com/package/@mongez/react-form/v/4.0.0).

## Summary

Severity: high = security exposure or materially incorrect user state;
medium = broken workflow or tooling; low = noise, ergonomics, or a contract question.

| ID | Finding | Package | Severity | 5.34.3 review status |
| --- | --- | --- | --- | --- |
| DW-01 | Notification locale stub omits configured locales | Core generator | medium | Source finding remains; scaffold run pending |
| DW-02 | HTTP test-server teardown delays Vitest exit | Core | medium | Needs reproduction |
| DW-03 | Module JSON dictionaries unavailable in test workers | Core | medium | Needs reproduction |
| DW-04 | Common JSON error-envelope customization missing | Core | low | Capability addressed by opt-in `http.errorResponse` in 5.34.3 |
| DW-05 | Config discovery imports co-located test files | Core | low | Needs reproduction |
| DW-06 | Hidden fields stripped before resource evaluation | Cascade | low | Source finding remains |
| DW-07 | Development mail log lacks a readable body | Core | low | Source finding remains; capture hook is usable |
| DW-08 | Expected rejected refresh logs a transaction error | Auth / Cascade | low | Needs reproduction |
| DW-09 | Google token exchange lacks timeout and endpoint injection | Auth | medium | Source finding remains |
| DW-10 | Route inspection misses session-based guards | Core / Auth | low | Needs reproduction |
| DW-11 | Imported `shared` loses its request store after HMR | Web | medium | Needs reproduction |
| DW-12 | `useId()` differs across SSR and hydration trees | Web | medium | Needs reproduction |
| DW-13 | Refresh and locale change omit session installation | Web | high | Source finding remains, including central swap inspection |
| DW-14 | Native pre-hydration submission sends sensitive fields by GET | Mongez form / Web | high | Source finding remains in form 4.0.0 and Web 5.34.3 examples |
| DW-15 | Expired refresh rows consume session-cap slots | Auth | medium | Source finding remains |

DW-02 and DW-03 are recurring reports originally observed on an earlier release;
the other thirteen are additional findings first recorded on 5.30.0/5.31.0.
They are not fifteen newly reproduced bugs on 5.34.3.

## DW-01: Notification locale stub omits configured locales

**Package:** Core. **First recorded:** 2026-10-17, 5.30.0.
**5.34.3:** source finding remains; fresh generation not executed.

**Evidence:** `esm/generations/stubs.mjs` still contains the notification
translation stub `"notFound": { "en": "Notification not found" }`.

**Generic reproduction:** create a disposable web application pinned to 5.34.3,
configure `app.localeCodes` as `en` and `ar`, and add notifications using the
package generator. Inspect `src/app/notifications/utils/locales.json`, then run
`warlock generate.typings` and the application's typecheck/build.

**Expected:** generated files satisfy configured locales. **Previously observed:**
typings generation fails with `notifications.notFound: missing locale code "ar"`.
**Suggested change:** generate a string for every configured locale, using an
explicit fallback when a stub translation is unavailable; retain strict validation.
**Temporary workaround:** manually add the missing locale string.
**Acceptance:** fresh bilingual generation passes without manual edits; also
cover a non-default locale set.

## DW-02: HTTP test-server teardown delays Vitest exit

**Package:** Core. **First recorded:** 2026-10-17, 5.30.0; reproduced on 5.31.0.
**5.34.3:** needs reproduction.

**Generic reproduction:** use `startHttpTestServer({ web: false })` in global
setup and await `stopHttpTestServer()` in teardown. Run a minimal Vitest spec;
compare with a run without the HTTP fixture.
**Previously observed:** assertions pass and the server reports stopping, then
Vitest waits and prints `close timed out after 10000ms` / a message that
something prevents the Vite server from exiting.

**Root cause:** unconfirmed. Historical diagnostics showed numerous open
`FILEHANDLE` resources, without proving the responsible subsystem.
**Expected/acceptance:** teardown awaits release of owned handles, watchers,
timers, and connectors; the process exits without the timeout. Distinguish
passing assertions from clean teardown. No reliable workaround is established;
`forceExit` would hide rather than resolve the leak.

## DW-03: Module JSON dictionaries unavailable in test workers

**Package:** Core. **First recorded:** 2026-10-17, 5.30.0; reproduced on 5.31.0.
**5.34.3:** needs reproduction.

**Generic reproduction:** define a translated key in a module's
`utils/locales.json`, use generated test setup, and call the server translation
helper from a Vitest worker in both configured languages.
**Previously observed:** `t("notifications.notFound")` returns the raw key despite
the dictionary defining it. Explicit worker-side registration makes it resolve.

**Expected:** documented test bootstrap loads module dictionaries, or documents
a required registration step. This is separate from Web route-local snapshots.
**Temporary workaround:** register required module dictionaries in test setup.
**Acceptance:** assert actual translations in each worker; do not infer a
broken development-server discovery path solely from worker behavior.

## DW-04: JSON error-envelope customization — capability addressed

**Package:** Core. **First recorded:** 2026-10-17, 5.30.0.
**5.34.3:** addressed through a public extension point; consumer migration pending.

**Original concern:** `ForbiddenError("nope", { error_code: "x" })` produces
`{ error: "nope", payload: { error_code: "x" } }`, while direct response helpers
can produce another shape. There was no common customization point. This is
an extension-point request, not inherently invalid JSON.

**5.34.3 evidence:** the changelog and `skills/send-response/SKILL.md` document
`http.errorResponse`. `esm/http/error-response.mjs` registers an `onSend`
formatter through the server and passes `{ status, body, requestId }`.
It covers JSON 400–599, including thrown HTTP errors, validation, parsing,
unmatched routes, and rate limits. It is opt-in; unchanged defaults still nest
`payload`. HTML, files, streams, and already-sent responses are outside its scope.

**Action:** use the supported hook instead of requesting the same capability.
Narrow `body` and select intentional public fields; do not blindly merge data.
Remove per-controller adapters only after equivalent behavior is verified.
**Acceptance:** thrown/direct errors, validation 422, unmatched 404, and rate-limit
429 use the configured envelope; defaults and formatter-failure fallback remain safe.

## DW-05: Config discovery imports co-located test files

**Package:** Core. **First recorded:** 2026-10-17, 5.30.0; reproduced on 5.31.0.
**5.34.3:** needs reproduction.

**Generic reproduction:** add a Vitest `describe`/`it` file at
`src/config/example.spec.ts`, then start the application or test fixture.
**Previously observed:** the config loader imports it as configuration, reports
a missing default export, registers tests in unrelated runs, or fails global
setup with `Vitest failed to find the current suite`.

**Expected/change:** exclude `*.spec.*`, `*.test.*`, and documented test-only
folders from config discovery. **Temporary workaround:** keep config specs
outside `src/config`. **Acceptance:** the spec is collected once by the test
runner and never executed by config loading in development, tests, or production.

## DW-06: Hidden columns disappear before resource evaluation

**Package:** Cascade. **First recorded:** 2026-10-17, 5.30.0.
**5.34.3:** source finding remains; serialization contract needs review.

**Evidence:** `esm/model/methods/serialization-methods.mjs` still evaluates
`new resource(stripHiddenFields(data, hidden)).toJSON()`.
**Generic reproduction:** configure a hidden `secret` column and a resource
deriving public `has_secret` from it. Compare `model.toJSON()` with explicit
resource construction from the model. Historically the former reports false
while the latter reports true.

**Expected:** resources can perform documented derivations, or pre-resource
hidden-field semantics are explicitly documented. Review ordering without
exposing hidden output; full-data resource evaluation still needs a final
privacy boundary. **Temporary workaround:** construct a deliberate public
resource from the model where supported, retaining hidden-column protection.
**Acceptance:** the derived field is correct and the original secret never
appears in model, resource, or page-payload output.

## DW-07: Development mail lacks a readable body by default

**Package:** Core. **First recorded:** 2026-10-17, 5.30.0.
**5.34.3:** source finding remains; usability/documentation enhancement.

**Evidence:** development mode in `esm/mail/send-mail.mjs` still logs the masked
recipient, subject, and HTML length. It also emits captured-mail data; an
extension point already exists.
**Generic reproduction:** send a verification-code message in development mode
without production transport credentials and inspect default output.
**Previously observed:** developers cannot read the code/body there.

**Suggested change:** document captured-mail preview or offer an explicitly
enabled development-only viewer. Do not make sensitive body logging unconditional
or enable it in production. **Temporary workaround:** a development-only
captured-mail listener/viewer. **Acceptance:** readable preview without real
email delivery, disabled outside its intended mode.

## DW-08: Expected refresh rejection produces a transaction error log

**Packages:** Auth / Cascade. **First recorded:** 2026-10-17, 5.30.0;
observed on 5.31.0. **5.34.3:** needs reproduction.

**Generic reproduction:** issue a cookie session, revoke its token family,
then request a protected endpoint with the old refresh cookie. Include replay
and already-revoked-token cases.
**Previously observed:** an expected 401 accompanies
`Transaction operation failed, rolled back everything` at error level.
**Root cause:** suspected logging of a rollback before Auth handles an expected
rejection, not confirmed.

**Expected/acceptance:** expected credential rejection is not logged as a database
failure. Genuine database failures remain visible; replay detection, family
revocation, and rollback behavior remain intact. No authentication workaround
is required for the historical response behavior itself.

## DW-09: Google token exchange lacks timeout and endpoint injection

**Package:** Auth. **First recorded:** 2026-10-17, 5.30.0.
**5.34.3:** source finding remains.

**Evidence:** `esm/providers/google-provider.mjs` is unchanged from the inspected
5.31.0 file. `exchangeCode()` calls `fetch(TOKEN_ENDPOINT, ...)` without an abort
signal; authorization, token, and JWKS locations remain module constants.
**Generic reproduction:** exercise exchange through a controlled fake/proxy
that accepts the request but never returns. Endpoint injection is a separate
missing test capability; avoid unsafe host overrides for real provider traffic.

**Expected/change:** bounded authentication calls and a documented injectable
transport or constrained test endpoints, retaining issuer, audience, nonce,
signature, and PKCE validation. **Temporary workaround:** a separately tested
OIDC client with bounded calls. **Acceptance:** stalled token calls terminate;
verify JWKS timeout behavior and fake-provider integration without live secrets.

## DW-10: Route inspection misses session-based guards

**Packages:** Core / Auth. **First recorded:** 2026-10-18, 5.31.0.
**5.34.3:** needs reproduction.

**Generic reproduction:** register a mutation inside a group protected by
`sessionMiddleware({ userTypes: "user" })`. Confirm unauthenticated access is
rejected, then run `warlock agents-md` without write options and inspect its
classification. Check supported permission middleware separately.
**Previously observed:** genuinely guarded routes appear unguarded. This is a
tooling false positive, not evidence that the API itself is exposed. The 5.31
`authMiddleware()` recognition change alone did not establish session-guard coverage.

**Expected/acceptance:** inspection recognizes documented guard descriptors
through groups and distinguishes optional auth/public routes. Verify real
unauthenticated requests as well as generated output.

## DW-11: Imported `shared` disconnects after development HMR

**Package:** Web. **First recorded:** 2026-10-18, 5.31.0.
**5.34.3:** needs a real watched-server reproduction.

**Generic reproduction:** declare `SharedContext.theme`; write
`shared.theme = "light"` in root setup middleware. Start `warlock dev`, request
a page, edit a component/hook, then request it again; repeat several edits.
**Previously observed:** initial requests succeed, then fail with
`` `shared` is not connected to a request store `` until restart. Error-page
rendering can fail while enumerating `shared` too.
**Root cause:** suspected duplicate module evaluation with an unconnected
resolver, not proven.

**5.34 distinction:** central-swap shared-snapshot publication fixes client
consumers after swaps; it does not itself prove the server HMR problem fixed.
**Temporary workaround:** root-loader data for document-only preferences. Lower
loaders do not receive that return, so this does not replace cross-level `shared`.
**Acceptance:** repeated watched edits preserve connectivity and concurrent
request isolation; cover setup add/edit/delete too.

## DW-12: `useId()` differs between SSR and hydration

**Package:** Web; observed with Mongez form 4.0.0.
**First recorded:** 2026-10-18, 5.31.0. **5.34.3:** needs reproduction.

**Generic reproduction:** render a form without an explicit ID in a page beneath
a layout, plus an ID-dependent layout control. Compare SSR markup and hydration
in a real browser; include repeated instances and navigation.
**Previously observed:** React reports differing `form-_R_...` IDs; the DOM can
retain the server ID while handlers reference the client ID. Both pages and
layouts were affected. An SSR/client ancestor-tree difference was suspected,
not reduced to a proven root cause.

**Temporary workaround:** stable explicit instance IDs, deriving label/hint/error/
panel IDs from distinct bases. Do not globally replace React IDs on an unverified
diagnosis. **Acceptance:** IDs and label/ARIA references agree across SSR,
hydration, and navigation; preserve normal `useId()` and library compatibility.

## DW-13: Refresh and locale changes omit session installation

**Package:** Web. **First recorded:** 2026-10-18, 5.31.0.
**5.34.3:** source finding remains; fresh browser run pending.

**Evidence:** `esm/client/navigation/refresh.mjs` and
`esm/client/navigation/change-locale-code.mjs` hydrate shared data without
`installSession(result.payload.session)`. Central `applySwap` in
`navigation-root.mjs` also publishes shared data without installing the session.
The ordinary navigation path separately calls `installSession`.
**Generic reproduction:** configure `web.session` with a public projection;
render `useUser()` in a persistent header, mutate the user's name via an
authenticated API, then call `refresh()`. Repeat with a locale change and compare
with Link navigation. Historically loader data updates while name/avatar stays stale.

**Suggested change:** install the fetched session at a consistent transition
boundary, including guest/null sessions, without publishing superseded identity.
**Temporary workaround:** install the authoritative browser-safe projection
returned by an account API before refresh; it grants no server permissions.
**Acceptance:** identity UI updates after each transition; cover sign-out,
failures, and out-of-order responses.

## DW-14: Native pre-hydration form submission exposes fields in URLs

**Packages:** Mongez form 4.0.0 / Web API-form integration.
**First recorded:** 2026-10-18, Web 5.31.0.
**5.34.3:** source finding remains in the dependency and integration examples.

**Evidence:** form `esm/components/Form.mjs` supplies no default `method`.
Web's `skills/submit-a-form/SKILL.md` still shows
`<Form onSubmit={login.submit}>` without one. A JavaScript request method in
`useSubmitForm` does not configure the native HTML form method.
**Generic reproduction:** render that form with named email/password inputs and
a submit button, disable JavaScript or delay hydration, enter synthetic values,
and press Enter or click Submit.
**Previously observed:** GET navigation includes the fields in the query,
exposing values to history/access logs and possible additional URL propagation.

**Suggested change:** consider a safe POST default in Mongez's HTML form,
preserving deliberate overrides; immediately correct Web examples. Distinguish
Web's page-action `Form`, which already supports native POST.
**Temporary workaround:** explicit `method="post"`, with a deliberately supported
native fallback or hydration-gated submission for an API-only flow. POST prevents
URL leakage but does not make an unsupported no-JS path functional. Server-side
validation, authorization, and CSRF/origin protections remain independent.
**Acceptance:** browser click/Enter with disabled/delayed JavaScript never puts
synthetic secrets in URLs; hydrated success/failure behavior remains correct.

## DW-15: Expired refresh rows consume session-cap slots

**Package:** Auth. **First recorded:** 2026-10-20, 5.31.0.
**5.34.3:** source finding remains.

**Evidence:** `esm/models/refresh-token/refresh-token.model.mjs` is unchanged
from the inspected 5.31.0 file. `RefreshToken.enforceMax()` filters user, user
type, and `revoked_at`, without `expires_at`; `activeFor()` already applies
`expires_at > now`.
**Generic reproduction:** with a cap of ten, create nine live sessions and an
unrevoked expired row newer than them, then issue another token. The expired row
is counted and can cause unnecessary revocation of the oldest live session.

**Expected/change:** expired rows consume no live-session slots; reuse the active
predicate while preserving ordering and concurrent-issuance guarantees.
**Temporary workaround:** a configured token-model subclass with the live-row
predicate. Browser/device-specific limits remain a separate application policy.
**Acceptance:** expired/revoked rows consume no slots; active rows respect the
cap, including concurrent issuance.

## Maintainer next steps

Prioritize credential exposure and stale identity, then validate the remaining
source-supported paths. Reproduce the seven pending reports in clean 5.34.3
fixtures before assigning current open/fixed labels. Treat the error formatter
as an available solution and mail preview/resource ordering as capability or
contract discussions where appropriate.

Record the shipping version and a focused regression for each accepted fix.
Remove a consumer workaround only after verifying its replacement in the actual
request, rendering, or test lifecycle. Documentation recommendations are in
[Web skills improvements](WEB_SKILLS_IMPROVEMENTS.md).
