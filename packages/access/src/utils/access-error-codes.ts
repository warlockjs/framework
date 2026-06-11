/**
 * Wire-stable error codes emitted by `@warlock.js/access`. Map these in your
 * error transformer the way you map `AuthErrorCodes`. A value change here is a
 * breaking change for any client that reacts to the code.
 */
export enum AccessErrorCodes {
  /** EC100 — authenticated, but missing the required permission. */
  Forbidden = "EC100",
}
