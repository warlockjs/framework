import { ForbiddenError } from "@warlock.js/core";
import { AuthErrorCodes } from "../utils/auth-error-codes";

/**
 * A provider login found an existing account with the same email, but
 * `auth.providers.linkExisting` does not allow linking it automatically —
 * by default because that account never verified the address. Answers `403`
 * with `EC012`. The user signs in with their password (or verifies their
 * email) first; the provider can then be linked from a signed-in session.
 */
export class ProviderAccountLinkBlockedError extends ForbiddenError {
  public readonly code = AuthErrorCodes.ProviderAccountLinkBlocked;

  public constructor(
    message = "An account with this email already exists. Sign in with your password first, then link this provider from your account settings.",
  ) {
    super(message, { errorCode: AuthErrorCodes.ProviderAccountLinkBlocked });
    this.name = "ProviderAccountLinkBlockedError";
  }
}
