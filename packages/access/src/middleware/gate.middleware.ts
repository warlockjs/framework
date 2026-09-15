import type { Auth } from "@warlock.js/auth";
import { t, type HttpContext, type Middleware, type Response } from "@warlock.js/core";
import type { ModelSchema } from "@warlock.js/cascade";
import { can, canAll, canAny } from "../services/access";
import { AccessErrorCodes } from "../utils/access-error-codes";

/*
 * @warlock.js/access does NOT augment `RequestUser`, deliberately. An
 * interface can extend at most one class hierarchy, so a library-side
 * `interface RequestUser extends Auth<ModelSchema>` PRE-CLAIMS the one
 * extends slot every app needs for its own model — the app's
 * `interface RequestUser extends User {}` then fails with TS2320, and the
 * app can never see its own auth model on `request.locals.user`. (Core
 * documents the same hazard for member-level augmentation in
 * `http/middleware/utils/idempotency-key.ts`.)
 *
 * The contract instead: an app using gates augments `RequestUser` (declared
 * by `@warlock.js/auth`, which also augments core's `RequestLocals` with the
 * `user` key) to its OWN `Auth`-derived model; `authUserOf` below is the
 * single boundary where access asserts that contract to satisfy `can()`'s
 * parameter type.
 */

/**
 * The one place access bridges `request.locals.user` (app-augmented via
 * `@warlock.js/auth`'s `RequestUser`, empty by default) to the
 * `Auth<ModelSchema>` that `can()`/`canAny()`/`canAll()` require. The
 * assertion is the contract boundary, not a shortcut: the app's `RequestUser`
 * augmentation promises an `Auth`-derived model, and the auth middleware
 * placed exactly that instance at `request.locals.user` at runtime. Kept to
 * this single accessor so the promise is asserted once, visibly, instead of
 * scattered.
 */
function authUserOf(request: HttpContext["request"]): Auth<ModelSchema> | undefined {
  return request.locals.user as unknown as Auth<ModelSchema> | undefined;
}

function deny(response: Response) {
  return response.forbidden({
    error: t("access.errors.forbidden"),
    errorCode: AccessErrorCodes.Forbidden,
  });
}

/**
 * Gate a route on a single permission (class-level). Stack it AFTER
 * `authMiddleware`, which sets `request.locals.user`.
 *
 * @example
 * router.post("/orders", createOrder, {
 *   middleware: [authMiddleware([]), gate("orders.create")],
 * });
 */
export function gate(permission: string): Middleware {
  return async ({ request, response }: HttpContext) => {
    const user = authUserOf(request);

    if (!user) return deny(response);

    if (!(await can(user, permission))) return deny(response);
  };
}

/** Gate a route on holding ANY of the listed permissions. */
export function gateAny(permissions: string[]): Middleware {
  return async ({ request, response }: HttpContext) => {
    const user = authUserOf(request);

    if (!user) return deny(response);

    if (!(await canAny(user, permissions))) return deny(response);
  };
}

/** Gate a route on holding ALL of the listed permissions. */
export function gateAll(permissions: string[]): Middleware {
  return async ({ request, response }: HttpContext) => {
    const user = authUserOf(request);

    if (!user) return deny(response);

    if (!(await canAll(user, permissions))) return deny(response);
  };
}
