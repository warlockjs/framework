/**
 * A per-call deadline for the network tools: one timer plus the run's
 * abort signal, kept armed from the request until the body has been read.
 *
 * The shared outbound guard bounds the connect + headers phase only, so a
 * server that answers quickly and then drips its body would otherwise hold
 * the tool call open for as long as it likes. Each tool creates one
 * deadline per call, passes {@link CallDeadline.signal} to the request, and
 * wraps every body read in {@link CallDeadline.race} — which settles as soon
 * as the deadline passes or the caller aborts, even when the underlying
 * stream ignores the signal.
 */
export interface CallDeadline {
  /** Aborts when the deadline passes or the caller's signal aborts. */
  readonly signal: AbortSignal;
  /** Whether the deadline itself (not the caller) fired. */
  readonly timedOut: boolean;
  /**
   * Settle with `promise`, or reject with the abort reason the moment the
   * signal aborts — whichever comes first.
   */
  race<T>(promise: Promise<T>): Promise<T>;
  /** Stop the timer; call once the body has been read. */
  clear(): void;
}

/**
 * Create a {@link CallDeadline} that fires after `timeoutMs` (rejecting with
 * `onTimeout()`) or when `external` aborts (rejecting with its reason).
 */
export function createDeadline(
  timeoutMs: number,
  external: AbortSignal | undefined,
  onTimeout: () => Error,
): CallDeadline {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(onTimeout());
  }, timeoutMs);

  const onExternalAbort = (): void => {
    clearTimeout(timer);
    controller.abort(external?.reason);
  };

  if (external?.aborted) {
    onExternalAbort();
  } else {
    external?.addEventListener("abort", onExternalAbort, { once: true });
  }

  const signal = controller.signal;

  return {
    signal,
    get timedOut() {
      return timedOut;
    },
    race<T>(promise: Promise<T>): Promise<T> {
      if (signal.aborted) {
        // Keep a late rejection of the abandoned promise from surfacing as unhandled.
        promise.catch(() => undefined);

        return Promise.reject(signal.reason);
      }

      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(signal.reason);

        signal.addEventListener("abort", onAbort, { once: true });

        promise.then(
          (value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
          },
          (error: unknown) => {
            signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      });
    },
    clear() {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}
