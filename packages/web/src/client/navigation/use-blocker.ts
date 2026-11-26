import { useEffect, useRef } from "react";
import { routerEvents, type BeforeNavigatePayload } from "../../routing/router-events";

/** The default question asked before leaving a page that has unsaved work. */
const DEFAULT_MESSAGE = "You have unsaved changes. Leave this page?";

/**
 * Decides whether a blocked navigation may go ahead: a message shown in the
 * browser's confirm dialog, or a function that answers `true` to leave and
 * `false` to stay (it may return a promise, so an in-page dialog works).
 */
export type BlockerConfirm =
  | string
  | ((navigation: BeforeNavigatePayload) => boolean | Promise<boolean>);

export type UseBlockerOptions = {
  /**
   * Also ask the browser's own leave-site prompt while the blocker is active,
   * which covers reloads and closing the tab. Off by default.
   */
  beforeUnload?: boolean;
};

/**
 * Guard against leaving the page while `when` is true: a `<Link>` click,
 * `navigateTo()` and the Back/Forward buttons all ask `confirm` first, and the
 * navigation is cancelled when it answers `false`.
 *
 * @param when `true` to block, or a function read at the moment of each
 * navigation (so it can look at a form's live state). A clean form never
 * prompts.
 * @param confirm a message for the browser's confirm dialog, or a function
 * returning `true` to leave. Defaults to a generic unsaved-changes question.
 * @param options `{ beforeUnload: true }` also prompts on reload and tab close.
 */
export function useBlocker(
  when: boolean | (() => boolean),
  confirm?: BlockerConfirm,
  options?: UseBlockerOptions,
): void {
  const latest = useRef({ when, confirm });

  // Kept current after each render, so a navigation reads the latest `when`
  // and `confirm` without re-subscribing.
  useEffect(() => {
    latest.current = { when, confirm };
  });

  useEffect(() => {
    const isActive = (): boolean => {
      const current = latest.current.when;

      return typeof current === "function" ? current() : current;
    };

    return routerEvents.onBeforeNavigate((navigation) => {
      if (!isActive()) return;

      const ask = latest.current.confirm ?? DEFAULT_MESSAGE;

      if (typeof ask === "string") return window.confirm(ask) ? undefined : false;

      const answer = ask(navigation);

      if (typeof answer === "boolean") return answer ? undefined : false;

      return answer.then((leave) => (leave ? undefined : false));
    });
  }, []);

  const beforeUnload = options?.beforeUnload === true;

  useEffect(() => {
    if (!beforeUnload) return;

    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      const current = latest.current.when;

      if (!(typeof current === "function" ? current() : current)) return;

      // The browser shows its own wording; setting returnValue is what makes
      // every engine ask.
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [beforeUnload]);
}
