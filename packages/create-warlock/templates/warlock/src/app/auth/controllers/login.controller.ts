import { type Request, type RequestHandler } from "@warlock.js/core";
import { UserResource } from "app/users/resources/user.resource";
import { loginSchema, type LoginSchema } from "../schema/login.schema";
import { loginService } from "../services/auth.service";

/**
 * Login controller
 * POST /auth/login
 */
export const loginController: RequestHandler<Request<LoginSchema>> = async ({
  request,
  response,
}) => {
  const result = await loginService(request.validated(), {
    userAgent: request.userAgent,
    ip: request.ip,
  });

  return response.success(result);
};

loginController.description = "User Login";

loginController.validation = {
  schema: loginSchema,
};

// The starter disables refresh tokens; add tokens.refreshToken when enabling them.
loginController.responseSchema = {
  200: {
    body: {
      user: UserResource,
      tokens: {
        accessToken: { token: "string", expiresAt: "string" },
      },
    },
  },
  401: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  403: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
