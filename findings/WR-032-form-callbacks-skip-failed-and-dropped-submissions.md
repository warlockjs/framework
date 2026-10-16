# WR-032 — `<Form>` gives no callback for failed or dropped submissions

- **Packages:** `@warlock.js/web` 5.30.0 (`<Form>`, `submitAction` outcomes)
- **Classification:** feature request / contract gap (the behaviour matches the code, but leaves callers blind)
- **Found:** 2026-10-16, while replacing an app's hand-rolled cancel `fetch()` with
  `<Form independent>`.

## Expected

Every enhanced submission ends in a callback the component can observe, so busy UI can release and
the user can be told what happened: success, redirect, validation error, **network failure** and
**dropped** (superseded, aborted or unmounted).

## Observed

`esm/components/form.mjs` `handleSubmit` maps outcomes like this:

- `success` and `redirected` call `onSuccess(outcome)`
- `error` calls `onError(actionData)`
- `failed` (a network or transport failure from `client/navigation/action-submitter.mjs`) calls nothing
- `dropped` (superseded or aborted) calls nothing

So a `<Form independent>` whose request cannot reach the server finishes silently. The caller can
only infer the failure later, when `useIsSubmitting()` drops back to `false` without either callback
having fired.

## Minimal reproduction

```tsx
<Form to="runs.cancel" independent onSuccess={() => setMsg("ok")} onError={() => setMsg("rejected")}>
  <button>Cancel</button>
</Form>
// Stop the server (or block the request in DevTools) and submit: neither callback fires, msg stays unset.
```

## Requests

- An `onSettled(outcome)` callback that fires for every outcome type, or `onFailure(outcome)` for
  `failed` and `dropped` (with `outcome.reason`).
- Document the full outcome union on `FormProps`.
- Related request: per-submitter `independent` (for example `<button data-independent>` or a
  `formIndependent` prop), so one form can make only its Cancel button independent. Today the app
  renders a second `<Form independent>` with duplicated hidden fields and points the button at it with `form=`.

## Workaround in the app

When `useIsSubmitting()` turns `false` and the cancellation never reported back through `onSuccess`
or `onError`, the hook shows "The cancellation request did not return…".
