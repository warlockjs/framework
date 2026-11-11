import { ForbiddenError, type Middleware } from "@warlock.js/core";
import type { GuardedRequest } from "app/auth/requests/guarded.request";
import type { User } from "app/users/models/user";

/**
 * Allow the request only for a signed-in user whose `role` is `"admin"`.
 * Use it inside `guarded()`, which signs the user in first:
 *
 * @example
 * guarded(() => {
 *   router.group({ middleware: [adminMiddleware] }, () => {
 *     router.route("/users").list(listUsersController);
 *   });
 * });
 *
 * New accounts get `role: "user"`. Promote an account by setting its `role`
 * to `"admin"` from a seed, a command or the database.
 */
export const adminMiddleware: Middleware = ({ request }) => {
  // `user` is unset when this runs outside `guarded()`; that is refused too.
  const user = (request as GuardedRequest).locals.user as User | undefined;

  if (user?.get("role") !== "admin") {
    throw new ForbiddenError("This action needs an admin account. Sign in with an admin user.");
  }
};
