import { Application, environment } from "@warlock.js/core";

/**
 * The one answer to "may a visitor see this error's details": the raw message,
 * the stack, where it happened (the development error panel) and submitted
 * values echoed in validation messages.
 *
 * Fails closed. A production bundle (`warlock start`) never discloses,
 * whatever `NODE_ENV` says, and outside it only `NODE_ENV` `development`
 * (or unset) and `test` do — a deploy started with `NODE_ENV=staging` or any
 * other value is treated as production. Details are still logged server-side
 * either way.
 */
export function discloseErrorDetails(): boolean {
  if (Application.runtimeStrategy === "production") return false;

  const current = environment();

  return current === "development" || current === "test";
}
