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
 * Read-only: reads the list the router collected while routes registered. It
 * therefore reports on the routes this process has loaded — a run before route
 * registration sees nothing.
 */
export const handlerSignatureCheck: DoctorCheck = {
  name: "handler-signature",
  run: () => {
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
