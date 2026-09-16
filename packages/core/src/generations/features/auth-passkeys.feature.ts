import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

/**
 * `warlock add auth-passkeys` — passkey (WebAuthn) login for @warlock.js/auth.
 * Installs the server library only; the browser half is `@simplewebauthn/browser`,
 * which belongs in whatever bundle runs the ceremony.
 */
export const authPasskeysFeature: FeatureDefinition = {
  description:
    "Passkey login for @warlock.js/auth (installs @simplewebauthn/server; add @simplewebauthn/browser to your client). Configure auth.passkeys { rpID, rpName, origin }",
  dependencies: {
    "@warlock.js/auth": INSTALLED_WARLOCK_VERSION,
    "@simplewebauthn/server": "^13.1.0",
  },
};
