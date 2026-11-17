/**
 * The error a request's middleware or handler threw that core answered with a
 * 5xx itself. That error never leaves the request as a throw, so the request
 * lifecycle hands it to `onRequestEnd` from here. Internal: not re-exported.
 */
const handledErrors = new WeakMap<object, unknown>();

/** Keeps `error` as the reason core answered `request` with a 5xx. */
export function noteHandledRequestError(request: object, error: unknown): void {
  handledErrors.set(request, error);
}

/** The error kept for `request`, once; `undefined` when none was kept. */
export function takeHandledRequestError(request: object): unknown {
  const error = handledErrors.get(request);

  handledErrors.delete(request);

  return error;
}
