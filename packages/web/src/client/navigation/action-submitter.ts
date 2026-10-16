import { routerEvents } from "../../routing/router-events";
import { hydrateShared } from "../../shared";
import { clearPrefetchCache } from "./prefetch";
import type { RefreshRuntime } from "./refresh";
import { beginSubmitting } from "./submitting-store";
import { submitPageAction } from "./submit-page-action";

/**
 * Submit a page's action from the browser and apply the outcome (design §2.5).
 *
 * Built by `NavigationRoot` on the same four callbacks as the refresher, so a
 * submit and a navigation take tickets from ONE counter: a navigation that
 * starts while an action is pending drops the action's result, and a newer
 * submit aborts an older one.
 */
export type ActionSubmitRuntime = RefreshRuntime & {
  /**
   * Client navigation, used for the redirect outcome (push). A returned
   * promise is awaited before the submission settles: it resolves once the
   * destination page is on screen (or the navigation was overtaken, or fell
   * back to a full load). `void` settles at once.
   */
  navigate: (url: string) => void | Promise<void>;
  /**
   * Observe the race counter WITHOUT taking a ticket: the predicate answers
   * whether no navigation, refresh or ordinary submit has claimed one since.
   * Used by `independent` submissions, which must neither abort the operation
   * in flight nor be aborted by it. Absent in a runtime that has no counter.
   */
  observeTicket?: () => () => boolean;
};

/** Per-call options for {@link ActionSubmitter}. */
export type ActionSubmitOptions = {
  /**
   * Submit alongside whatever is already in flight instead of sharing or
   * superseding it: a Cancel next to a long-running Start. The submission
   * takes no navigation ticket, so it neither aborts the pending submit or
   * navigation nor is aborted by it; its result is applied unless a
   * navigation (or another ordinary operation) started after it, and unless
   * the page it was made on has since been left. A double submit of the SAME
   * submission (same {@link ActionSubmitOptions.dedupeKey}, URL and form data)
   * still shares one request; a different row's form never does.
   */
  independent?: boolean;
  /**
   * Identifies the form instance making an `independent` submission, so two
   * forms that post the same action (a Cancel per row) are never merged.
   * `<Form>` passes its own; callers without one get URL plus form data.
   */
  dedupeKey?: string;
  /** Cancels this submission only. An aborted submission resolves `dropped`. */
  signal?: AbortSignal;
};

export type ActionSubmitOutcome =
  | { type: "success" }
  | { type: "error"; actionData: Readonly<Record<string, unknown>> }
  | { type: "redirected"; url: string }
  | { type: "failed"; reason: string }
  /** A newer navigation or submit overtook this one; nothing was applied. */
  | { type: "dropped" };

export type ActionSubmitter = (
  url: string,
  formData: FormData,
  options?: ActionSubmitOptions,
) => Promise<ActionSubmitOutcome>;

export function createActionSubmitter(runtime: ActionSubmitRuntime): ActionSubmitter {
  let inFlight: Promise<ActionSubmitOutcome> | undefined;

  async function run(url: string, formData: FormData): Promise<ActionSubmitOutcome> {
    const { isCurrent, signal, complete } = runtime.claimTicket();
    const endSubmitting = beginSubmitting();
    let completionWaitsForCommit = false;

    try {
      const result = await submitPageAction(url, formData, signal);

      if (!isCurrent() || result.type === "aborted") return { type: "dropped" };

      if (result.type === "hard-fail") {
        const error = new Error(`Warlock page action failed: ${result.reason}`);

        console.warn("Warlock page action failed:", result.reason);
        routerEvents.emitNavigationError({ url, mode: "replace", error });

        return { type: "failed", reason: result.reason };
      }

      if (result.type === "redirect") {
        clearPrefetchCache();
        // Awaited: the submission (and `useIsSubmitting()`) ends when the
        // redirected page's fresh loader data is on screen, not when the 204
        // arrived. Otherwise a second submit could start against the previous
        // page's data, such as a stale revision.
        const settled = runtime.navigate(result.url);

        // The navigation took its own ticket synchronously (replacing this
        // one) or took none (a same-page fragment); either way this ticket is
        // over, and leaving it open would keep the router busy forever.
        complete?.();
        await settled;

        return { type: "redirected", url: result.url };
      }

      const previous = runtime.readCurrent();

      if (result.type === "actionOnly") {
        // Errors only: keep the tree, replace what `useActionData` reads.
        runtime.writeCurrent(
          {
            payload: { ...previous.payload, actionData: result.actionData },
            tree: previous.tree,
            routeSource: previous.routeSource,
          },
          complete,
        );
        completionWaitsForCommit = true;

        return { type: "error", actionData: result.actionData };
      }

      let tree: Awaited<ReturnType<typeof runtime.buildTree>>;

      try {
        tree = await runtime.buildTree(result.payload);
      } catch (error) {
        console.warn("Warlock page action could not build the page tree:", error);
        routerEvents.emitNavigationError({ url, mode: "replace", error });

        return { type: "failed", reason: "tree build failed" };
      }

      if (!isCurrent()) return { type: "dropped" };

      hydrateShared(result.payload.shared);
      clearPrefetchCache();

      runtime.writeCurrent(
        {
          payload: result.payload,
          tree,
          routeSource:
            result.payload.name === previous.payload.name
              ? previous.routeSource
              : result.payload,
        },
        complete,
      );
      completionWaitsForCommit = true;

      return { type: "success" };
    } finally {
      endSubmitting();
      if (!completionWaitsForCommit) complete?.();
    }
  }

  async function runIndependent(
    url: string,
    formData: FormData,
    callerSignal: AbortSignal | undefined,
  ): Promise<ActionSubmitOutcome> {
    const isCurrent = runtime.observeTicket?.() ?? (() => true);
    const endSubmitting = beginSubmitting();

    try {
      const result = await submitPageAction(url, formData, callerSignal);

      if (result.type === "aborted" || callerSignal?.aborted) return { type: "dropped" };

      if (result.type === "hard-fail") {
        const error = new Error(`Warlock page action failed: ${result.reason}`);

        console.warn("Warlock page action failed:", result.reason);
        routerEvents.emitNavigationError({ url, mode: "replace", error });

        return { type: "failed", reason: result.reason };
      }

      // Checked before the redirect too: a "Stop" in a persistent layout must
      // not pull the user off a page they navigated to after submitting it.
      if (!isCurrent() || callerSignal?.aborted) return { type: "dropped" };

      if (result.type === "redirect") {
        clearPrefetchCache();
        await runtime.navigate(result.url);

        return { type: "redirected", url: result.url };
      }

      const previous = runtime.readCurrent();

      if (result.type === "actionOnly") {
        runtime.writeCurrent({
          payload: { ...previous.payload, actionData: result.actionData },
          tree: previous.tree,
          routeSource: previous.routeSource,
        });

        return { type: "error", actionData: result.actionData };
      }

      let tree: Awaited<ReturnType<typeof runtime.buildTree>>;

      try {
        tree = await runtime.buildTree(result.payload);
      } catch (error) {
        console.warn("Warlock page action could not build the page tree:", error);
        routerEvents.emitNavigationError({ url, mode: "replace", error });

        return { type: "failed", reason: "tree build failed" };
      }

      if (!isCurrent() || callerSignal?.aborted) return { type: "dropped" };

      hydrateShared(result.payload.shared);
      clearPrefetchCache();

      const latest = runtime.readCurrent();

      runtime.writeCurrent({
        payload: result.payload,
        tree,
        routeSource:
          result.payload.name === latest.payload.name ? latest.routeSource : result.payload,
      });

      return { type: "success" };
    } finally {
      endSubmitting();
    }
  }

  const independentInFlight = new Map<string, Promise<ActionSubmitOutcome>>();

  return (url, formData, options) => {
    if (options?.independent === true) {
      const key = `${options.dedupeKey ?? ""}\u0000${url}\u0000${serializeFormData(formData)}`;
      const existing = independentInFlight.get(key);

      if (existing) return existing;

      const promise = runIndependent(url, formData, options.signal).finally(() => {
        if (independentInFlight.get(key) === promise) independentInFlight.delete(key);
      });

      independentInFlight.set(key, promise);

      return promise;
    }

    // A double submit shares the request in flight instead of sending a second.
    if (inFlight) return inFlight;

    const promise = run(url, formData).finally(() => {
      if (inFlight === promise) inFlight = undefined;
    });

    inFlight = promise;

    return promise;
  };
}

/**
 * A stable text form of a submission's fields, for telling a double submit
 * (same fields) from a different submission. A file is identified by its
 * name, size, type and modification time, never by reading it.
 */
export function serializeFormData(formData: FormData): string {
  const parts: string[] = [];

  for (const [name, value] of formData.entries()) {
    const text =
      typeof value === "string"
        ? `s:${value}`
        : `f:${value.name}:${value.size}:${value.type}:${value.lastModified}`;

    parts.push(`${JSON.stringify(name)}=${JSON.stringify(text)}`);
  }

  return parts.join("&");
}

let connected: ActionSubmitter | undefined;

/** Installed by the navigation runtime at mount, torn down with `undefined`. */
export function connectActionSubmitter(next: ActionSubmitter | undefined): ActionSubmitter | undefined {
  const previous = connected;

  connected = next;

  return previous;
}

/** Whether a navigation runtime is connected to submit page actions. */
export function hasActionSubmitter(): boolean {
  return connected !== undefined;
}

/** What `<Form>` calls. Resolves `undefined` when no runtime is connected. */
export async function submitAction(
  url: string,
  formData: FormData,
  options?: ActionSubmitOptions,
): Promise<ActionSubmitOutcome | undefined> {
  return connected?.(url, formData, options);
}
