---
name: preserve-feedback-and-motion
description: "Keep feedback correct in SSR pages: field errors, announcements, failed refresh after a successful write, flash messages across full loads, pending states, duplicate-submit guards, reduced motion. Read when messages vanish or retries repeat writes."
---

# Warlock web — preserve feedback and motion

Read this with `submit-a-form.md` (posting and refresh) and `handle-a-form-action.md` (on-page actions). This topic covers the feedback and motion patterns around them. It describes patterns only; the framework exports no toast, flash or motion primitive, so build these with your own components and storage.

## Field errors stay with fields

Show actionable validation errors next to the field they describe, linked with `aria-describedby` and `aria-invalid`. Put general outcomes ("saved", "could not save") in a live region so screen readers hear them. A toast alone can vanish before it is read, so a persistent failure needs visible text that stays on the page until the user acts.

## Mutation failure is not a failed refresh

A form submit can succeed on the server and then fail to refresh the page data. Treat these as different outcomes:

- **Mutation failed**: nothing changed. Keep the input, show the error, and let the user retry.
- **Mutation succeeded, refresh failed**: the side effect already happened. Report success, then report the stale view separately. A retry here would repeat a completed write (a second order, a second comment).

Model the two states distinctly in your component. Do not map every non-2xx response to "try again" without checking whether the server committed the change.

## Full loads are a lifecycle boundary

A full document load (a hard navigation, a locale change that reloads, a redirect after login) destroys in-memory state. A success message set before the redirect is gone by the time the next page renders.

If feedback must cross a navigation, use an app-owned flash mechanism:

- Write it once, at the moment of the outcome, with a short expiry.
- Consume it once on the destination page, then delete it.
- Validate the stored payload before rendering it; it came from storage, not from your code.
- Store a translation key plus safe parameters, not rendered text, so it can be shown in the destination locale.
- Keep secrets, tokens and personal data out of it.
- Handle storage failures (quota, blocked cookies) by degrading to no message, not an error page.

Use the same pattern for confirmation state ("your email was changed") after a redirect.

## Model the request lifecycle explicitly

Give each action an explicit state: idle, pending, succeeded, retryable failure, and fatal failure. Then:

- Disable the submit control while pending, and ignore further submits for the same action. Disabling the button alone is not enough for fast double clicks or Enter key repeats; guard in the handler too.
- Ignore completions for an action the user has left. When the page changes, a late response must not write into the new view.
- Keep the user's input when a request fails, so a retry does not start from an empty form.

## Motion

Share motion durations and easings as tokens so components agree. Respect `prefers-reduced-motion`: drop transform animations and keep opacity changes short or remove them.

```css
@media (prefers-reduced-motion: reduce) {
  .toast,
  .drawer {
    transition: none;
  }
}
```

Animations must never delay focus, keyboard handling, authorization checks, or the completion of the action. A close animation that holds the DOM for 300 ms must not block the server call behind it, and focus must move to the next logical target immediately.

## Clean up timers and observers

Exit animations use timers, and observers watch sizes and visibility. Clear them on unmount and on rapid open and close:

```tsx
useEffect(() => {
  const timer = window.setTimeout(() => setVisible(false), 300);

  return () => window.clearTimeout(timer);
}, [closing]);
```

Cancel pending timers when the component unmounts or when a newer open replaces the older close, or the old timer will hide the new content.
