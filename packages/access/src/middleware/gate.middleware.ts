import { t, type Middleware, type Request, type Response } from "@warlock.js/core";
import { can, canAll, canAny } from "../services/access";
import { AccessErrorCodes } from "../utils/access-error-codes";

function deny(response: Response) {
  return response.forbidden({
    error: t("access.errors.forbidden"),
    errorCode: AccessErrorCodes.Forbidden,
  });
}

/**
 * Gate a route on a single permission (class-level). Stack it AFTER
 * `authMiddleware`, which sets `request.user`.
 *
 * @example
 * router.post("/orders", createOrder, {
 *   middleware: [authMiddleware([]), gate("orders.create")],
 * });
 */
export function gate(permission: string): Middleware {
  return async (request: Request, response: Response) => {
    if (!request.user) return deny(response);

    if (!(await can(request.user, permission))) return deny(response);
  };
}

/** Gate a route on holding ANY of the listed permissions. */
export function gateAny(permissions: string[]): Middleware {
  return async (request: Request, response: Response) => {
    if (!request.user) return deny(response);

    if (!(await canAny(request.user, permissions))) return deny(response);
  };
}

/** Gate a route on holding ALL of the listed permissions. */
export function gateAll(permissions: string[]): Middleware {
  return async (request: Request, response: Response) => {
    if (!request.user) return deny(response);

    if (!(await canAll(request.user, permissions))) return deny(response);
  };
}
