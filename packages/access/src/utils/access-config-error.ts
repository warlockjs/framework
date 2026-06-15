/**
 * Thrown when `@warlock.js/access` is misconfigured (e.g. no resolver). Unlike a
 * runtime resolution failure — which fails CLOSED (denies) — a config error is a
 * developer mistake, so the engine re-throws it LOUD instead of silently denying.
 */
export class AccessConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AccessConfigError";
  }
}
