import { t, type RequestHandler } from "@warlock.js/core";
import { v } from "@warlock.js/seal";
import { forgotPasswordService } from "../services/forgot-password.service";

/**
 * Forgot password controller
 * POST /auth/forgot-password
 */
export const forgotPasswordController: RequestHandler = async ({ request, response }) => {
  const { email } = request.validated();

  await forgotPasswordService(email);

  return response.success({
    message: t("auth.otpSent"),
  });
};

forgotPasswordController.description = "Request password reset";

forgotPasswordController.validation = {
  schema: v.object({
    email: v.email(),
  }),
};

forgotPasswordController.responseSchema = {
  200: { body: { message: "string" } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
