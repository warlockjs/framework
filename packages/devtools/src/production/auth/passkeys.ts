import type { DevtoolsPasskeys } from "./types";

type Options = Record<string, unknown>;

/** The slice of `@simplewebauthn/server` (v13) the monitor uses; the package is an optional peer. */
type SimpleWebAuthnServer = {
  generateRegistrationOptions: (options: Options) => Promise<{ challenge: string }>;
  verifyRegistrationResponse: (options: Options) => Promise<{
    verified: boolean;
    registrationInfo?: {
      credential: {
        id: string;
        publicKey: Uint8Array;
        counter: number;
        transports?: string[];
      };
    };
  }>;
  generateAuthenticationOptions: (options: Options) => Promise<{ challenge: string }>;
  verifyAuthenticationResponse: (options: Options) => Promise<{
    verified: boolean;
    authenticationInfo: { newCounter: number };
  }>;
};

/**
 * Passkey ceremonies over `@simplewebauthn/server`, or `null` when that
 * package cannot be imported.
 */
export async function loadDevtoolsPasskeys(): Promise<DevtoolsPasskeys | null> {
  let webauthn: SimpleWebAuthnServer;

  try {
    const specifier = "@simplewebauthn/server";

    webauthn = (await import(/* @vite-ignore */ specifier)) as SimpleWebAuthnServer;

    if (typeof webauthn.generateRegistrationOptions !== "function") return null;
  } catch {
    return null;
  }

  const credentialsOf = (account: { passkeys: { id: string; transports: string[] }[] }) =>
    account.passkeys.map((passkey) => ({ id: passkey.id, transports: passkey.transports }));

  return {
    async registrationOptions({ account, rpId, rpName }) {
      const options = await webauthn.generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userName: account.email,
        userID: new TextEncoder().encode(account.id),
        attestationType: "none",
        excludeCredentials: credentialsOf(account),
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      });

      return { options, challenge: options.challenge };
    },

    async verifyRegistration({ response, challenge, origin, rpId }) {
      const verification = await webauthn.verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        throw new Error("The passkey registration was not verified.");
      }

      const { id, publicKey, counter, transports } = verification.registrationInfo.credential;

      return {
        id,
        publicKey: Buffer.from(publicKey).toString("base64url"),
        counter,
        transports: transports ?? [],
      };
    },

    async authenticationOptions({ account, rpId }) {
      const options = await webauthn.generateAuthenticationOptions({
        rpID: rpId,
        userVerification: "required",
        allowCredentials: credentialsOf(account),
      });

      return { options, challenge: options.challenge };
    },

    async verifyAuthentication({ response, challenge, origin, rpId, account }) {
      const presented = (response as { id?: unknown } | null)?.id;
      const stored = account.passkeys.find((passkey) => passkey.id === presented);

      if (!stored) throw new Error("The passkey is not registered for this account.");

      const verification = await webauthn.verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        credential: {
          id: stored.id,
          publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
          counter: stored.counter,
          transports: stored.transports,
        },
        requireUserVerification: true,
      });

      if (!verification.verified) throw new Error("The passkey was not verified.");

      return { id: stored.id, newCounter: verification.authenticationInfo.newCounter };
    },
  };
}
