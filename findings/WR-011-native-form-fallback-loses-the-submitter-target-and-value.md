# WR-011: Native Form fallback loses the submitter target and value

Packages: `@warlock.js/web` 5.29.0, React 19.3.0 and JSDOM 26.1.0;
Node 22.13.0. This is a reproduced public-component fallback defect; a real
browser/HTTP comparison of the enhanced path is still pending.

Expected: a submit button with `formAction="/expected?mode=inspect"`,
`name="purpose"` and `value="inspect"` retains that target and named value when
the component falls back to native submission because no navigation runtime is
connected. Actual: the installed public `Form` calls `form.submit()` against the
original document URL and the submitter's named value is absent. An independent
owned DOM reproduction observes both differences; it issues no HTTP request.

Installed source: `esm/components/form.mjs`, `handleSubmit()`. It creates
`new FormData(form, submitter)` for the enhanced call but obtains the target only
from `currentUrl(form)`, ignoring `submitter.formAction`. When the navigation
runtime returns `undefined`, its `form.submit()` fallback neither applies the
submitter target nor retains that button's name/value. The enhanced target
omission is a source fact; only the no-runtime fallback has been independently
executed here.

Minimal shape to reproduce using the public component in a DOM environment:

```tsx
<Form>
  <input name="retained" defaultValue="original-command" />
  <button type="submit" name="purpose" value="inspect" formAction="/expected?mode=inspect">
    Inspect
  </button>
</Form>
```

Start at `/original?choice=create` without a connected Warlock navigation
runtime. In the owned probe, intercept the native `HTMLFormElement.submit()`
call to observe its target/data, and compare them to the button's resolved
`formAction` and `new FormData(form, button)`. Expected target is `/expected?mode=inspect`
with both fields. Actual fallback uses `/original?choice=create` and contains only
`retained`. The complete runnable Node/JSDOM probe and captured observations are
`.tmp/coordinator/framework-form-target/reproduce.mjs` and `evidence.json`.

Related API feature request: `Form` exposes `to` and `params` but no query target
prop. Its `action` is a named page action, not a URL. The public `href()` supports
query parameters, but `Form` forwards only route name/params. Recovery inspection
needs a query purpose without replacing the durable original form body.

Application workaround: a native button supplies `formAction`; a focused
synchronous public `onSubmit` callback sets that same fixed form target before
the framework reads it. The frozen 47-file onboarding handoff and three-file
polish overlay pass actual owned Chrome/native inspection and recovery, including
a genuine incomplete initialization and a dropped committed response. Hydrated
and no-JavaScript flows retain the exact original command and only clear it after
a verified explicit recovered receipt. Evidence and bundle/alias provenance are
in `/tmp/bureau-2-workspace-initialization-ui-ready-4qqkom18/evidence/` and
`/tmp/bureau-2-initialization-polish-ready-afx3d6q7/evidence/`. The control purpose and inspected
fingerprint remain out of the retained command body. This does not repair generic
named submitter fallback semantics; existing Bureau forms carry their actual
command in inputs. No framework package patch was made.

Request: honor native submitter target/value in both enhanced and fallback paths,
add a public query/URL target API without changing named-action semantics, and
cover no-runtime, enhanced, keyboard and alternate-submit-button cases in a real
browser. Keep this separate from WR-002's redirect completion ordering.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
