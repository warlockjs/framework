import { log } from "@warlock.js/logger";
import { User } from "app/users/models/user";
import { createOtpService, otpHashKey } from "./otp.service";

/**
 * Example Usage:
 * await forgotPasswordService("user@example.com");
 */

/**
 * Handle forgot password request.
 *
 * Resolves the same way, and just as fast, whether or not an account uses
 * `email`: the account lookup, the code and its delivery run after the
 * response is sent (see {@link issuePasswordResetCode}), so neither the answer
 * nor its timing tells a caller which emails are registered. Only a real
 * account gets a reset code.
 *
 * @param email - User email address
 * @returns Promise<void>
 */
export async function forgotPasswordService(email: string): Promise<void> {
  // Checked before anything else, so a missing secret fails the same way for every email.
  otpHashKey();

  // Not awaited: the caller answers without waiting for the lookup. A failure
  // is logged for you, never sent to the caller.
  void issuePasswordResetCode(email).catch((error: unknown) => {
    log.error("auth", "forgot-password", error);
  });
}

/**
 * Look the account up and, when one uses `email`, create a reset code and
 * deliver it. Unknown emails do nothing.
 */
export async function issuePasswordResetCode(email: string): Promise<void> {
  const user = await User.first({ email });

  if (!user) {
    return;
  }

  const { code } = await createOtpService({
    target: email,
    channel: "email",
    type: "password-reset",
    userId: user.id,
    userType: user.userType,
  });

  await sendPasswordResetCode(user, code);
}

/**
 * Deliver the reset code to the account owner. Nothing is sent until this is
 * wired to a mail (or SMS) service, so no password can be reset yet.
 *
 * @example
 * // after `warlock add mail`:
 * await sendMail({
 *   to: user.get("email"),
 *   subject: "Your password reset code",
 *   text: `Your code is ${code}. It expires in 15 minutes.`,
 * });
 */
async function sendPasswordResetCode(_user: User, _code: string): Promise<void> {
  // Send `_code` to `_user` here. Never return it in the HTTP response or write it to a log.
}
