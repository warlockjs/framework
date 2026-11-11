import { t } from "@warlock.js/core";
import { v } from "@warlock.js/seal";
import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { logoutService } from "../services/auth.service";

/**
 * Logout controller
 * POST /auth/logout
 *
 * Typed as `GuardedRequestHandler` because the route sits inside `guarded()`
 * (see `../routes.ts`). A plain `RequestHandler` types `request.locals.user`
 * as `RequestUser | undefined`, which is not assignable to `logoutService`.
 */
export const logoutController: GuardedRequestHandler = async ({ request, response }) => {
  // With the refresh token from login, only this session ends. Without it,
  // every session of the user is signed out (`auth.refreshToken.logoutWithoutToken`).
  await logoutService(request.locals.user, request.accessToken, request.input("refreshToken"));

  return response.success({
    message: t("auth.loggedOut"),
  });
};

logoutController.description = "User Logout";

logoutController.validation = {
  schema: v.object({
    refreshToken: v.string().optional(),
  }),
};

logoutController.responseSchema = {
  200: { body: { message: "string" } },
  401: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
