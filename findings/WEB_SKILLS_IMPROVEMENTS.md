# Web skills: proposed upstream improvements for 5.34.3

Review date: **2026-10-21**. Baseline: `@warlock.js/*` **5.34.3** and
`@mongez/react-form` **4.0.0**. Status: **proposal for maintainer review**.

This handoff proposes reusable improvements to the Warlock.js and
Mongez package skills. It contains corrections to existing topics, draft new
topics, ownership, and acceptance checks. It does not change the installed
packages or active skills.

## 1. Scope and evidence

Reviewed the published Web and Core **5.34.3** package artifacts, their skill
entrypoints, relevant topics, changelogs, selected runtime files, and Mongez
form **4.0.0** skills/implementation. This revises the earlier 5.31-based proposal
against the requested release. The consumer application was not upgraded, and
no new browser, scaffold, HMR, or application test suite was run. Historical
browser findings remain explicitly separate from this source review.

Evidence considered:

- Native form submission defaults and pre-hydration credential exposure.
- SSR/client ID mismatches and request-store failures after hot reload.
- Session state remaining stale after refresh or locale changes.
- Resource serialization ordering and access to hidden model fields.
- Keyboard, focus, mixed-direction content, and reduced-motion behavior.
- A radio visual-state regression found in browser checks despite passing
  non-browser checks.

The immutable inputs are [Web 5.34.3](https://registry.npmjs.org/@warlock.js/web/-/web-5.34.3.tgz)
and [Core 5.34.3](https://registry.npmjs.org/@warlock.js/core/-/core-5.34.3.tgz).
Runtime findings, reproduction recipes, and their evidence levels are in
[Framework issues](FRAMEWORK_ISSUES.md). A documentation change does not close a
runtime defect, and a historical report is not proof of a current reproduction.

### Already present in 5.34.3 — retain and extend

| Earlier recommendation | Current release evidence | Revised action |
| --- | --- | --- |
| Add setup/UI separation guidance | Web `use-page-setup-files` and updated page/root/layout topics; corrected in 5.34.1 | Use the existing contract and keep examples consistent; do not propose it as a missing feature. |
| Fix introductory page-guard config examples | `protect-a-page` now shows separate `.setup.ts` files exporting `config` | Resolved in the reviewed skill; retain the corrected examples. |
| Add browser tooling and a testing skill | Core `test-browser`, `warlock e2e`, and `@warlock.js/core/e2e`, added in 5.34.0 | Extend/cross-link this topic with SSR/form/session regressions rather than create a competing browser framework. |
| Keep package descriptions compact | Package changelogs document description condensation in 5.34.3 | Retain concise entrypoints; put conditional details in topics. |
| Provide one JSON error-envelope formatter | Core `http.errorResponse`, added in 5.34.3 | Cross-link the existing API; no duplicate capability proposal. |
| Refresh shared snapshots for retained consumers | Web central-swap publication, fixed in 5.34.0 | Do not confuse this client fix with the separately reported server HMR or session-installation findings. |

### Where upstream changes belong

The published package identifies its framework source as `packages/web` in
`warlockjs/framework`. Its original topic files are exposed locally as
`node_modules/@warlock.js/web/skills/<topic>/SKILL.md`, with `skills/index.md`
as the router. In that source repository, the corresponding targets are
`packages/web/skills/<topic>/SKILL.md` and `packages/web/skills/index.md`.
Confirm the current upstream layout before editing.

Agent-kit assembles those into `.codex/skills/warlock-js-web/SKILL.md` and
`<topic>.md`. Edit the package source, publish through its normal process, then
sync the consumer app. Direct changes to `.codex/skills`, `.claude/skills`, or
`node_modules` are not a durable upstream fix.

Mongez form integration contracts belong in `@mongez/react-form`'s own skill
sources; cross-link them from Warlock. Application architecture policy belongs
in an explicitly adopted conventions skill or shared conventions package.
Preserve the distinction between a framework API contract and an application's
preferred organization.

## 2. Remaining corrections and focused additions

Priority: **P0** prevents credential exposure; **P1** prevents broken runtime
behavior or misleading contracts; **P2** improves maintainability and coverage.

| Priority | Target | Recommendation | Evidence |
| --- | --- | --- | --- |
| P0 | Web `submit-a-form`; Mongez form entrypoint/examples | Make every mutation example safe before hydration; document native behavior explicitly. | Installed `Form.mjs` supplies no default method. |
| P1 | Web `render-client-only` | Fix the first example, which evaluates `window` before `ClientOnly` runs. | The topic's own later explanation contradicts its opening example. |
| P1 | Web hydration topics | Add a scoped historical `useId()` caveat and regression target. | Recorded on 5.31.0; reproduction on 5.34.3 remains pending. |
| P1 | Web `load-page-data` | Distinguish the reported server HMR failure from client shared-snapshot publication. | Historical request-store disconnection; no fresh 5.34.3 HMR run. |
| P1 | Web `navigate-on-the-client`, `protect-a-page`, `localize-pages` | Explain the remaining session-installation gap. | 5.34.3 refresh, locale change, and central swap paths publish shared data without installing the fetched session. |
| P2 | Mongez `form-hydration` | Replace `catch (...: any)` and the unguarded asynchronous edit example. | Current examples can apply late data to the wrong record and omit rejection handling. |
| P2 | Web navigation/projection examples | Reconcile navigation instructions and distinguish generated declarations from app-owned types. | The navigation gotcha omits the named-object overload; the session typing sample mixes registry ownership. |
| P2 | Web `test-a-page` / Core `test-browser` | Cross-link browser verification and extend boundary-specific recipes. | SSR/HTTP examples do not prove hydration, native submission, or computed visual states; browser tools already exist. |

### 2.1 Safe forms before hydration — highest priority

Add the following guidance to `submit-a-form` before its first example, and
cross-link it from Mongez's web form entrypoint:

> A React submit handler cannot prevent a native submission before hydration or
> when JavaScript fails. Declare `method="post"` on mutation forms. Never submit
> credentials, tokens, or other sensitive fields using GET. The method passed to
> `useSubmitForm` configures its JavaScript request; it does not configure the
> rendered HTML form's native method or action.
>
> Choose the native fallback deliberately. For a flow that must work without
> JavaScript, use a supported server action or compatible POST endpoint. For an
> API-only enhanced flow, keep submit controls unavailable until hydration and
> provide an accessible explanation when JavaScript is unavailable. POST alone
> prevents query-string leakage but does not make an API-only form functional
> without JavaScript.

All `@mongez/react-form` examples in that topic should explicitly show
`method="post"`. Put the hydration guard in the reusable submit control rather
than repeating it across every screen. Give non-submit buttons `type="button"`.
Explain both button clicks and implicit Enter submission. A disabled button is
an interaction safeguard, not a security boundary: the server still validates,
authorizes, and applies its CSRF/origin policy independently.

Keep the two similarly named form components distinct:

| Form path | Intended behavior |
| --- | --- |
| `Form` from `@warlock.js/web` | Page action; native POST is part of the supported flow. |
| `Form` from `@mongez/react-form` + `useSubmitForm` | Enhanced API submission; explicitly configure native behavior. |
| Mongez form + `useSubmitAction` | Page-action integration; retain explicit POST in examples. |

The proposed runtime change is a safe POST default in Mongez's HTML form,
preserving an explicit caller override. Treat that as a separately reviewed
package behavior change; do not document it as already shipped.

**Acceptance:** with JavaScript disabled and with hydration delayed, neither
click nor Enter places synthetic credential values in any URL. Verify the
chosen native fallback, then hydrate and check success, validation failure,
network failure, and duplicate submission. Inspect real browser navigation,
not just the JSX source.

### 2.2 Correct the opening `ClientOnly` example

The current first example constructs a child containing
`window.localStorage.getItem(...)` in the parent render. `ClientOnly` cannot
defer an expression that has already executed. Replace that opening shape with:

```tsx
<ClientOnly fallback={<span>—</span>}>
  {() => <BrowserPreference />}
</ClientOnly>
```

Here `BrowserPreference` is a component whose browser access happens when it
renders; its module must also be safe to import on the server. If its module
touches browser globals during import, use the existing lazy-import plus
`Suspense` recipe. Browser storage can throw even after mount; a preference
reader should handle unavailable storage and return a safe fallback.

Do not recommend moving an entire page into `ClientOnly` as the permanent fix
for a framework tree mismatch. That removes useful SSR and can hide the cause.

**Acceptance:** run the first example through server rendering with no `window`,
then hydrate it in a browser. No exception or mismatch; unavailable storage
leaves the fallback/preference behavior usable.

### 2.3 Version-scoped hydration and HMR caveats

Consider one supporting topic, `known-version-limitations`, linked from the
affected tasks. Keep the general React advice and state the evidence level for
each version instead of calling every earlier finding a current bug:

| Version/evidence | Limitation | Temporary guidance | Removal proof |
| --- | --- | --- | --- |
| Web 5.31.0 historical; 5.34.3 reproduction pending | An imported `shared` proxy was reported to lose its server request-store connection after HMR. | For a value only needed by the document, return it from the root loader. Restarting confirms the symptom but is not a permanent fix. | Repeated watched edits and concurrent requests retain correct request-scoped values. |
| Web 5.31.0 historical; 5.34.3 reproduction pending | `useId()` differed between server and client in affected page/layout trees. | Accept explicit IDs at reusable boundaries; derive child IDs from a stable instance ID. Repeated instances require distinct IDs. | Real SSR/hydration checks for pages, layouts, multiple controls, and label/ARIA references. |
| Web 5.34.3 source finding remains | `refresh()` and locale changes omit installation of the fetched session; central swap does not supply it either. | An app may install the authoritative browser-safe user projection returned by its account API before the refresh/switch. | User name/avatar updates everywhere after each transition; guest/session removal is also handled. |
| Mongez form 4.0.0 + Web 5.34.3 examples, source finding remains | HTML form omits a method by default; integration examples omit it too. | Explicit native POST plus the chosen hydration/native-fallback policy. | Native submission checks prove safe defaults and explicit overrides. |

Source inspection is not a new browser reproduction. The HMR and ID mismatch
root-cause hypotheses remain hypotheses. The 5.34 shared-snapshot fix is a client
publication change, not proof that the server HMR problem or session-installation
gap is resolved. Neither pending report should be labelled fixed or open on
5.34.3 without the corresponding runtime check.

Do not generalize the workarounds into permanent rules such as “never use
`shared`,” “never use `useId()`,” or “never use a headless UI library.” Temporary
restrictions should remain tied to the affected runtime and documented evidence.
If a clean reproduction confirms a defect, fix the corresponding runtime
contract and retain its regression case.

The root-loader workaround does not replace `shared` for communication between
loader levels: lower loaders do not receive the root loader's return. Document
that boundary explicitly rather than suggesting an equivalent replacement.

The session workaround must use a deliberate public projection, never a raw
auth model, bearer token, password field, or refresh token. `installSession`
updates presentation state; it grants no server permissions. Once the runtime
installs fetched sessions consistently, remove the workaround and retain the
regression checks.

### 2.4 Align remaining examples with the 5.34.3 contract

Retain the already-correct setup-file and guard-export guidance. Page/layout/root
logic belongs in matching `.setup.ts` files under the published guidance;
components own UI. Use type-only loader/action imports and put metadata in
`config.metadata`. Root metadata and generated route registries already exist;
do not request them as missing features.

Remaining improvements in package topics:

- `navigate-on-the-client` already documents
  `navigateTo({ name, params, query })`; update the later gotcha that tells
  readers to resolve every named destination with `href()` first.
- Its “Current and previous routes” rendering example should follow its own
  SSR caveat: use request-derived route props, or gate client-only reads. Do not
  show an unconditional render-time pattern and warn against it underneath.
- The guarded-page typings illustration should keep application-owned
  `SessionRegistry` separate from generated `PageRouteRegistry`. Do not invite
  apps to maintain a handwritten duplicate of the generator output.
- State that authentication guards and staff/domain permission gates are
  different checks. A page called “admin” is not authorized merely because it
  uses `requireUser()`. Cross-link `@warlock.js/access`; secure mutation routes
  independently from pages.

**Acceptance:** compile representative examples against the 5.34.3 public
types and generated declarations; exercise guest, signed-in unauthorized, and
authorized requests. No broad cast or handwritten route map should be needed
to make the advertised type contract work.

### 2.5 Improve Mongez edit-form examples

Keep the existing useful distinction between reset baseline (`defaultValue`)
and live overwrite (`values` / `fill`), but make the asynchronous example safe:

- Replace `catch (error: any)` with `unknown` and the HTTP client's typed error
  narrowing, or a small runtime validator for an unknown external body.
- Abort or ignore superseded loads when the record changes or unmounts. A late
  response for record A must never fill the form for record B.
- Explain that `values` / `fill` overwrites live fields; do not manufacture a
  fresh object on every render or silently overwrite dirty user edits on a
  background refresh. Choose an explicit edit/refresh reconciliation policy.
- Surface rejected loads and saves. Preserve editable data on failure and
  show unknown server field errors at form level rather than dropping them.
- Use a safe native POST form in the full web example, linking the SSR caveat.

**Acceptance:** simulate out-of-order A/B responses, unmount, rejected load,
dirty edits during refresh, reset, late-mounting controls, and unknown 422 keys.
This is form-library documentation; keep Warlock-specific guards in its
integration topic.

## 3. New topics and extensions to existing topics

Prefer focused topics routed from the existing Web/Core skills. Controls, RTL,
and feedback are proposed guidance topics; browser verification extends the
existing Core topic. These drafts describe patterns, not imaginary framework
exports or a replacement for shipped functionality.

### 3.1 `build-accessible-controls`

**Suggested owner:** Web topic for SSR composition; cross-link Mongez's
`create-form-control` for registration/value semantics. Keep reusable control
implementations in the app or an appropriate UI package.

**Description:** Build SSR-compatible checkbox, radio, switch, select, date,
dialog, and popover interactions. Use for custom controls, keyboard navigation,
focus restoration, stable IDs, and validation accessibility. Not for choosing
an application's visual theme.

**Draft instructions:**

- Prefer native input semantics when customizing appearance. Keep the label,
  checked/value state, disabled state, focus target, and form registration
  connected. For composite widgets, use the appropriate accessible interaction
  pattern rather than adding roles to decorative markup.
- Use Mongez's existing input/error prop bags where appropriate; preserve blur,
  validation, ref, and caller-provided description associations. A radio group
  owns one selected value, and only the chosen option renders checked. Test the
  empty group as well as a populated value; inspect computed visuals, including
  `:indeterminate`, instead of checking attributes alone.
- Give each rendered instance a stable, unique ID base. Derive label, hint,
  error, trigger, and panel IDs from it. Apply affected-version guidance when
  the framework's `useId()` hydration contract is broken.
- A dialog has an accessible name, intentional initial focus, dismissal
  behavior, and focus return. A confirmation may focus Cancel when that is the
  safe product choice. Prevent duplicate pending actions and keep failure
  recoverable; confirmation policy itself belongs to the application.
- A popover distinguishes Escape from outside-pointer dismissal: returning
  focus must not steal it from the outside target the user selected. Measure
  viewport placement after mount; clean up observers and event listeners.
- A select/date widget needs keyboard behavior, selection announcement,
  disabled options/dates, and explicit empty/clear behavior. Localize its copy
  and configure calendar/first-weekday policy rather than assuming one locale.
- Keep a calendar date distinct from an instant. Do not shift a date-only
  `YYYY-MM-DD` value by parsing it as a timestamp and formatting in another zone.

**Suggested regression cases:** radio visual states, popover placement/cleanup,
date helpers, and dialog/confirmation behavior. Adapt these cases to the owning
package rather than copying an application's UI kit into the framework.

### 3.2 `build-rtl-and-mixed-direction-ui`

**Suggested owner:** Web topic, linked from `localize-pages` and `write-the-root`.

**Description:** Build localized LTR/RTL layouts and mixed-direction content in
server-rendered pages. Use for Arabic/Hebrew interfaces, mixed text, identifiers,
locale-dependent dates, or direction changes. Dictionary loading and locale URL
strategy remain in `localize-pages`.

**Draft instructions:**

- Derive document `lang` and `dir` from the request locale. Use logical spacing,
  alignment, and positioning. Mirror directional arrows when their meaning
  changes; do not mirror arbitrary icons or brand marks.
- Translate first-party labels, accessible names, empty/loading/error states,
  metadata, and generated control text. Route dictionary placement follows
  physical ancestry, not the declared URL; every flattened key has one owner.
- Treat content direction separately from interface direction. Use `dir="auto"`
  for user text that can mix scripts; isolate identifiers, timestamps, and
  speaker labels from the surrounding text. Keep email/code fields LTR when
  their content requires it, without forcing the whole form LTR.
- Format instants with an explicit locale and user timezone, identically on
  the server and first client render. Treat date-only values separately.
  Numeric input normalization is a product/schema choice: when localized digits
  are accepted, normalize and validate them deliberately on the server too.
- Verify actual Arabic copy and mixed Arabic/English text. A reversed sidebar
  alone does not prove RTL support. Test keyboard flow and focus in both modes.

Keep exact fonts, palettes, calendar choices, and digit policies configurable
by the consuming application. The package should teach general integration
decisions.

### 3.3 Extend Core `test-browser` for Web boundaries

**Suggested owner:** Core `test-browser`, cross-linked from Web `test-a-page`,
hydration, forms, and navigation. Do not create a duplicate testing entrypoint.

**Already shipped:** `warlock e2e`, `@warlock.js/core/e2e`, disposable app/browser
fixtures, console/network checks, viewport captures, and run evidence. The
5.34.3 topic also documents `browser.startupTimeoutMs`. Preserve those contracts.

**Proposed extension:** Verify behavior that SSR strings and HTTP tests cannot prove:
hydration, native pre-hydration submission, client transitions, focus, computed
control states, and HMR. Use when changing those boundaries or investigating a
browser-only regression; do not require a browser suite for every text edit.

**Draft instructions:**

1. Keep unit tests for loaders, services, and pure helpers. Add HTTP checks for
   status, middleware, validation, serialization, and cookie/cache behavior.
2. Use Core's documented `defineE2E` and owned fixtures for a clean framework
   regression. Preserve existing consumer browser tooling when already suitable.
   Use documented interaction/wait APIs and record evidence; do not test against
   a shared development server. A production fixture does not establish HMR;
   use an explicitly owned development fixture for watched-edit regressions.
3. For forms, cover JavaScript disabled/delayed and click/Enter submission. Use
   synthetic secrets and inspect navigation/network URLs for leakage.
4. For hydration, capture browser errors and compare label/ARIA references
   before/after mount. Include page and layout controls and repeated instances.
5. For navigation, cover Link, refresh, locale switch, Back/Forward, and failed
   or superseded requests. Assert both loader content and session-dependent
   chrome. Use watched dev-server edits for HMR; a mocked rerender cannot prove
   module identity survives a real reload.
6. For controls/overlays, exercise keyboard, focus return, pending/retry state,
   and checked/unchecked/empty visual states. Sample supported directions,
   themes, narrow/wide viewports, and reduced motion according to the change.
7. Separate “assertions passed” from teardown health. Report a test-server close
   timeout when it occurs; an exit code of zero does not establish clean teardown.

If the current browser helpers cannot express script disabling or a controlled
hydration delay, add a documented fixture or narrowly scoped capability. Do not
invent methods on the runner. Expected failed responses need narrow documented
allowlists so an intentional validation 422 does not hide unrelated failures.

Browser dimensions are viewport evidence, not proof of real-phone behavior.
Do not claim device, screen-reader, production, or no-JS checks that were not run.
This topic supplies test selection; the consuming repository determines its
test execution cadence.

### 3.4 `preserve-feedback-and-motion`

**Suggested owner:** Web topic, linked from navigation and form topics.

**Description:** Preserve accessible feedback and interaction state across
mutations, full navigation, locale changes, and animated overlays. Use for lost
success messages, duplicate actions, retry behavior, or reduced-motion support.
Does not choose whether a product must use toasts or confirmation dialogs.

**Draft instructions:**

- Keep actionable field errors associated with fields; announce general
  outcomes accessibly. A toast alone may be insufficient for a persistent
  failure. Distinguish mutation failure from a successful mutation followed by
  a failed refresh so a retry does not repeat a completed side effect.
- Treat a full document load as a lifecycle boundary: an in-memory toast can
  disappear before it is read. If cross-navigation feedback is required, use
  an app-owned flash mechanism. Consume it once, expire it, validate any stored
  payload, and keep it free of secrets. Translation keys plus safe parameters
  can allow rendering in the destination locale. Browser storage can fail.
- Model pending, success, retryable failure, and leaving states explicitly.
  Suppress duplicate submissions and ignore obsolete completions after navigation.
  Retain useful user input when the request fails.
- Share motion tokens; respect reduced motion. Animations must not delay
  focus, keyboard handling, authorization, or the completion of an action. Clean
  up exit timers and observers on unmount and rapid reopen/close.

Use flash-message handover, confirmation state, and motion cleanup as example
scenarios. Do not expose imaginary `useToast`, `flash`, or motion APIs as Web
exports: any new framework primitive needs a separate API proposal.

## 4. Optional shared architecture skill

If package maintainers want to distribute stricter code organization guidance,
add an opt-in `warlock-web-architecture` skill. It should teach feature ownership,
thin page/setup modules, named domain services, deliberate resource projections,
and cohesive behavior hooks.

Preserve the non-negotiable boundaries: server secrets and queries never enter
the browser graph, data projections are intentional, authorization is
server-side, and async work has clear ownership and cleanup. Link
`use-page-setup-files` for setup companions and type-only loader imports;
that existing topic already owns the contract.

Explicitly label the stronger preferences: a separate hook file for every
behavioral component, no web barrels, one default component per file, and exact
folder/type naming. Adopt them only where the consuming application's conventions
call for them; do not make them prerequisites for using Warlock examples.

For serialization, cross-link Cascade/Core resource guidance: a
derived public field that depends on a hidden column must be computed at a
resource boundary that can actually read the model. Do not “fix” it by removing
password hiding or returning the entire model. The Web topic needs the wire
contract, not a duplicate ORM manual.

## 5. Recommended delivery order and completion criteria

1. **Correct remaining unsafe and contradictory examples first:** native POST,
   eager `window` access, navigation overloads, and registry ownership. Preserve
   the already-correct setup-file and page-guard examples.
2. **Add the version-limitations topic:** include exact affected evidence and
   link it from each relevant task. Keep runtime fixes tracked independently in
   the owning package's issue tracker; documentation does not close those defects.
3. **Add controls and RTL topics; extend existing browser guidance:** link the
   new topics from Web and cross-link Core `test-browser` for runtime evidence.
   Add feedback/motion next if a broader production-UI surface is desired.
4. **Repair the Mongez examples at their source:** keep registration,
   hydration/value semantics, and typed HTTP handling in the owning packages.
5. **Validate the published result:** compile representative examples against
   5.34.3 and the supported dependency versions, run focused runtime/browser checks,
   publish, sync into a consumer, and confirm every routed topic exists.

Each accepted change should name its owning package, affected skill/topic,
supporting issue or demonstrated example, and observable acceptance result.
Each version workaround also needs a removal condition. Keep the entrypoint a
short router; put conditional detail in the relevant topic. Do not duplicate
whole topics across packages or bake application-specific palettes, wrappers,
release processes, and delivery cadence into a general framework skill.
