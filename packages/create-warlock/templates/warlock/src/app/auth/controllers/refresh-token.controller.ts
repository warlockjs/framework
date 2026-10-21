import { type RequestHandler } from "@warlock.js/core";
import { v } from "@warlock.js/seal";
import { refreshTokensService } from "../services/auth.service";

/**
 * Refresh token controller
 * POST /auth/refresh-token
 */
export const refreshTokenController: RequestHandler = async ({ request, response }) => {
  const token = request.input("refreshToken");

  const result = await refreshTokensService(token, {
    userAgent: request.userAgent,
    ip: request.ip,
  });

  return response.success(result);
};

refreshTokenController.description = "Refresh Access Token";

refreshTokenController.validation = {
  schema: v.object({
    refreshToken: v.string(),
  }),
};

refreshTokenController.responseSchema = {
  200: {
    body: {
      accessToken: { token: "string", expiresAt: "string" },
      refreshToken: { token: "string", expiresAt: "string" },
    },
  },
  401: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
