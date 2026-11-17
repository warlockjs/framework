import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { DevtoolsAuthStepResult } from "@contracts";
import { ApiError, apiFetch } from "@/api/client";
import type { AuthStepWithCodes } from "@/api/types";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

/** Turns a browser WebAuthn failure (prompt cancelled, no authenticator) into a message that says what to do. */
function passkeyFailure(error: unknown): Error {
  if (error instanceof ApiError) return error;

  const detail = error instanceof Error && error.message ? ` (${error.message})` : "";

  return new Error(
    `The passkey prompt did not finish${detail}. Try again, or use another sign-in method.`,
  );
}

/** Registers a passkey: `base` is `api/auth` while enrolling at sign-in, `api/account` from the account page. */
export async function registerPasskey(base: "api/auth" | "api/account"): Promise<AuthStepWithCodes> {
  const options = await apiFetch<RegistrationOptions>(`${base}/passkey/options`, {
    method: "POST",
    body: { purpose: "register" },
  });
  let response: Awaited<ReturnType<typeof startRegistration>>;

  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (error) {
    throw passkeyFailure(error);
  }

  return (
    (await apiFetch<AuthStepWithCodes | undefined>(`${base}/passkey/verify`, {
      method: "POST",
      body: { purpose: "register", response },
    })) ?? { stage: "active", csrf: null }
  );
}

/** Signs in with a passkey at the second-factor step. */
export async function authenticateWithPasskey(): Promise<DevtoolsAuthStepResult> {
  const options = await apiFetch<AuthenticationOptions>("api/auth/passkey/options", {
    method: "POST",
    body: { purpose: "login" },
  });
  let response: Awaited<ReturnType<typeof startAuthentication>>;

  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (error) {
    throw passkeyFailure(error);
  }

  return apiFetch<DevtoolsAuthStepResult>("api/auth/passkey/verify", {
    method: "POST",
    body: { purpose: "login", response },
  });
}
