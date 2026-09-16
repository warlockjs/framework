import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

/**
 * `warlock add auth-google` — Google sign-in for @warlock.js/auth. `jose` verifies
 * the id_token; auth loads it lazily, so it is only needed once this is added.
 */
export const authGoogleFeature: FeatureDefinition = {
  description:
    "Google sign-in for @warlock.js/auth (installs jose for id_token verification). Configure auth.providers.google, then call startProviderLogin / completeProviderLogin",
  dependencies: {
    "@warlock.js/auth": INSTALLED_WARLOCK_VERSION,
    jose: "^6.1.0",
  },
};
