import { useCallback, useEffect, useRef, useState } from "react";

export type ActionResult<T> = { ok: true; value: T } | { ok: false };

export type ActionState<TArgs extends unknown[], TResult> = {
  /** Runs the action. Never throws: a failure is kept in `error` and returned as `{ ok: false }`. */
  run: (...args: TArgs) => Promise<ActionResult<TResult>>;
  /** True while the action runs: disable the submit button with it. */
  pending: boolean;
  /** The last failure (show it with `ErrorMessage`); cleared when the action runs again. */
  error: unknown;
  clear: () => void;
};

/** Wraps an async user action with pending and error state, so a form stays open and shows what failed. */
export function useAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): ActionState<TArgs, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(action);

  useEffect(() => {
    latest.current = action;
  });

  const run = useCallback(async (...args: TArgs): Promise<ActionResult<TResult>> => {
    setPending(true);
    setError(null);

    try {
      return { ok: true, value: await latest.current(...args) };
    } catch (reason) {
      setError(reason);

      return { ok: false };
    } finally {
      setPending(false);
    }
  }, []);

  const clear = useCallback(() => setError(null), []);

  return { run, pending, error, clear };
}
