import { createElement, useContext, useEffect, useRef } from "react";
import type { FormHTMLAttributes, SubmitEvent as ReactSubmitEvent, ReactElement } from "react";
import { hasActionSubmitter, submitAction } from "../client/navigation/action-submitter";
import type { ActionSubmitOutcome } from "../client/navigation/action-submitter";
import { hrefByName } from "../routing/href-by-name";
import { queryStringOf } from "../routing/query-string";
import type { RouteQuery } from "../routing/route-table";
import { DocumentContext } from "./document-context";
import { fieldErrorId } from "./field-error";

export type FormProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "action" | "method" | "onError"
> & {
  /** The NAME of a page action (sent as hidden `_action`), not a URL. */
  action?: string;
  /** Another page's route name; its action is resolved with `href()`. */
  to?: string;
  params?: Record<string, string | number>;
  /**
   * Query string for the URL the form posts to, on `to`'s page or (without
   * `to`) the current one, which loses its own query. It names where the
   * submission goes, never what it carries: the body stays the form's fields,
   * and `action` stays the page action's name.
   */
  query?: RouteQuery;
  /**
   * Submit alongside whatever is already in flight instead of sharing or
   * superseding it, such as a Cancel next to a pending Start. Neither
   * submission aborts the other; a double submit of THIS form with the same
   * fields still shares one request, another form's submission never does,
   * and unmounting the form cancels its own submission only. Its result is
   * dropped if the user has navigated to another page meanwhile.
   */
  independent?: boolean;
  resetOnSuccess?: boolean;
  onSuccess?: (outcome: ActionSubmitOutcome) => void;
  onError?: (actionData: Readonly<Record<string, unknown>>) => void;
  /**
   * Called after every enhanced submission outcome, after onSuccess/onError:
   * success, redirected (url), error (actionData), failed (reason), or dropped
   * (superseded, aborted, navigated away, or unmounted (independent submissions
   * only)). Native submissions do not call it.
   */
  onSettled?: (outcome: ActionSubmitOutcome) => void;
};

type Submitter = HTMLElement & { form?: HTMLFormElement | null };

/**
 * Where a native submission would go: the submit button's own `formaction`
 * first (as the browser does), then the form's `action`, then this page.
 */
function targetUrl(form: HTMLFormElement, submitter: Submitter | null): string {
  const override = submitter?.getAttribute("formaction");

  if (override) return override;

  return form.getAttribute("action") ?? `${window.location.pathname}${window.location.search}`;
}

/**
 * Whether the runtime may enhance a submission to `target`: same origin and
 * `http:`/`https:`. A submit button can name any `formaction`, and enhancing a
 * cross-origin one would `fetch` it and then trust what that origin answered
 * (its redirect header, its page payload). The browser posts those natively.
 */
function canEnhance(target: string): boolean {
  let url: URL;

  try {
    url = new URL(target, window.location.href);
  } catch {
    return false;
  }

  return (
    (url.protocol === "http:" || url.protocol === "https:") && url.origin === window.location.origin
  );
}

let nextFormInstance = 0;

function formActionAttribute(
  to: string | undefined,
  params: Record<string, string | number> | undefined,
  query: RouteQuery | undefined,
): string | undefined {
  const search = queryStringOf(query);

  if (to !== undefined) return `${hrefByName(to, params)}${search}`;

  // A query-only URL resolves against the current page's path.
  return search === "" ? undefined : search;
}

/**
 * A real `<form method="post">` that the navigation runtime enhances: with the
 * runtime connected the submit goes through the page-action pipeline and the
 * page updates in place; without it (no JS, or before hydration) the browser
 * posts natively and the server renders the result.
 */
export function Form({
  action,
  to,
  params,
  query,
  independent,
  encType = "multipart/form-data",
  resetOnSuccess,
  onSuccess,
  onError,
  onSettled,
  onSubmit,
  children,
  ...rest
}: FormProps): ReactElement {
  const ref = useRef<HTMLFormElement>(null);
  const actionData = useContext(DocumentContext)?.payload.actionData as
    | { errors?: Record<string, string> }
    | undefined;
  const errors = actionData?.errors;

  // Wire aria on errored inputs after render; `<FieldError>` owns the message id.
  useEffect(() => {
    const form = ref.current;

    if (!form || !errors) return;

    for (const element of Array.from(form.elements)) {
      const field = element as HTMLInputElement;
      const key = field.name?.replace(/\[([^\]]*)\]/g, ".$1").replace(/^\./, "");

      if (!key) continue;

      if (key in errors) {
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", fieldErrorId(key));
      } else if (field.getAttribute("aria-describedby") === fieldErrorId(key)) {
        field.removeAttribute("aria-invalid");
        field.removeAttribute("aria-describedby");
      }
    }
  }, [errors]);

  // Set only while `<Form>` hands a submission back to the browser.
  const nativeFallback = useRef(false);
  // An independent submission is cancelled when its form unmounts.
  const independentController = useRef<AbortController | undefined>(undefined);

  // Dedupes this form's independent double submits without merging another
  // form's (a Cancel per row posts the same action with a different id).
  const instanceKey = useRef<string | undefined>(undefined);

  instanceKey.current ??= `form-${++nextFormInstance}`;

  useEffect(
    () => () => {
      independentController.current?.abort();
      // Effects can be cleaned up and re-run without an unmount (a hidden
      // `<Activity>` shown again); the next submission needs a live signal.
      independentController.current = undefined;
    },
    [],
  );

  async function handleSubmit(event: ReactSubmitEvent<HTMLFormElement>): Promise<void> {
    // The re-dispatched submit below: the browser performs it natively.
    if (nativeFallback.current) return;

    onSubmit?.(event);

    if (event.defaultPrevented) return;

    // No runtime (no JS yet, or never): leave the event alone, so the browser
    // posts natively with the submit button's `formaction` and its name/value.
    if (!hasActionSubmitter()) return;

    const form = event.currentTarget;
    const submitter = event.nativeEvent.submitter as Submitter | null;
    const target = targetUrl(form, submitter);

    // Another origin, or a non-http target: not this runtime's to fetch.
    if (!canEnhance(target)) return;

    event.preventDefault();

    let signal: AbortSignal | undefined;

    const independentSubmission =
      independent === true || submitter?.hasAttribute("data-independent") === true;

    if (independentSubmission) {
      independentController.current ??= new AbortController();
      signal = independentController.current.signal;
    }

    const outcome = await submitAction(target, new FormData(form, submitter), {
      independent: independentSubmission,
      signal,
      dedupeKey: instanceKey.current,
    });

    // The runtime went away mid-submit: let the browser do what it would
    // have done, through the same submit button.
    if (outcome === undefined) {
      submitNatively(form, submitter);

      return;
    }

    try {
      if (outcome.type === "success") {
        if (resetOnSuccess) form.reset();
        onSuccess?.(outcome);
      } else if (outcome.type === "redirected") {
        onSuccess?.(outcome);
      } else if (outcome.type === "error") {
        onError?.(outcome.actionData);
      }
    } finally {
      onSettled?.(outcome);
    }
  }

  function submitNatively(form: HTMLFormElement, submitter: Submitter | null): void {
    if (typeof form.requestSubmit !== "function") {
      form.submit();

      return;
    }

    // `requestSubmit(submitter)` dispatches a submit event synchronously that
    // `handleSubmit` lets through, and the browser then honours the button's
    // `formaction`, `formmethod` and name/value, which `form.submit()` drops.
    nativeFallback.current = true;

    try {
      form.requestSubmit(submitter?.form === form ? submitter : undefined);
    } finally {
      nativeFallback.current = false;
    }
  }

  return createElement(
    "form",
    // oxlint-disable-next-line react/refs -- The native form receives the forwarded ref; createElement does not read its current value.
    {
      ...rest,
      ref,
      method: "post",
      encType,
      action: formActionAttribute(to, params, query),
      onSubmit: handleSubmit,
    },
    action !== undefined
      ? createElement("input", { type: "hidden", name: "_action", value: action })
      : null,
    children,
  );
}
