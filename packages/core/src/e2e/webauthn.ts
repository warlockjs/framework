import type { BrowserPage } from "./page";
import { pageConnections } from "./page-connection";

/** What a virtual authenticator holds for one passkey. */
export type VirtualCredential = {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  signCount: number;
};

export type VirtualAuthenticator = {
  id: string;
  /** The passkeys the authenticator has stored. */
  credentials: () => Promise<VirtualCredential[]>;
  remove: () => Promise<void>;
};

/**
 * Adds a virtual authenticator (CTAP2, internal transport, user verification
 * on, taps answered automatically) to the page's browser, so a real WebAuthn
 * ceremony runs without a person. Test-only: it is not exported from the
 * package index.
 */
export async function addVirtualAuthenticator(page: BrowserPage): Promise<VirtualAuthenticator> {
  const cdp = pageConnections.get(page);

  if (!cdp) throw new Error("This page has no browser connection to add an authenticator to");

  await cdp.command("WebAuthn.enable", { enableUI: false });

  const { authenticatorId } = await cdp.command("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return {
    id: authenticatorId,
    credentials: async () =>
      (await cdp.command("WebAuthn.getCredentials", { authenticatorId })).credentials,
    remove: async () => {
      await cdp.command("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    },
  };
}
