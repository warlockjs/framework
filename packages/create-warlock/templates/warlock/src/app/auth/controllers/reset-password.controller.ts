import { t, type Request, type RequestHandler } from "@warlock.js/core";
import { resetPasswordSchema, type ResetPasswordSchema } from "../schema/reset-password.schema";
import { resetPasswordService } from "../services/reset-password.service";

/**
 * Reset password controller
 */
export const resetPasswordController: RequestHandler<Request<ResetPasswordSchema>> = async ({
  request,
  response,
}) => {
  await resetPasswordService(request.validated());

  return response.success({
    message: t("auth.passwordResetSuccess"),
  });
};

resetPasswordController.description = "Reset password with OTP";

resetPasswordController.validation = {
  schema: resetPasswordSchema,
};

resetPasswordController.responseSchema = {
  200: { body: { message: "string" } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
