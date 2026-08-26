import {
  describePositionalHandlerSuspect,
  listPositionalHandlerSuspects,
} from "../../../../router/positional-handler-diagnostics";
import type { DoctorCheck } from "../check.types";

/**
 * Surfaces route handlers still written against the v4 positional signature,
 * `(request, response)`. v5 calls a handler with a single context object, so
 * the second parameter is always `undefined` and the route fails on its first
 * request with a `TypeError` that names nothing.
 *
 * Verdicts:
 * - one or more suspects → `warn`;
 * - otherwise → `ok`.
 *
 * `warn`, never `fail`: the detection is a heuristic on the handler's declared
 * parameters, so a false positive is possible and must not break a build.
 *
 * NEEDS A BOOTED APP: the router collects suspects as routes register, so this
 * reads a list the boot pass filled. Before that pass existed the list was
 * always empty and this check always passed — it was green because it had
 * nothing to look at, which is indistinguishable from green because the app is
 * fine. It stays silent when there are no routes for the same reason: a check
 * with no input reports nothing rather than a clean bill of health.
 */
export const handlerSignatureCheck: DoctorCheck = {
  name: "handler-signature",
  run: (context) => {
    if (context.totalRoutes === 0) {
      return undefined;
    }

    const suspects = listPositionalHandlerSuspects();

    if (suspects.length === 0) {
      return {
        name: "handler-signature",
        status: "ok",
        detail: "no handlers look like the v4 positional signature",
      };
    }

    const headline =
      suspects.length === 1
        ? "1 handler looks like the v4 positional signature"
        : `${suspects.length} handlers look like the v4 positional signature`;

    return {
      name: "handler-signature",
      status: "warn",
      detail:
        `${headline}:\n` +
        suspects.map((suspect) => `  - ${describePositionalHandlerSuspect(suspect)}`).join("\n"),
    };
  },
};
