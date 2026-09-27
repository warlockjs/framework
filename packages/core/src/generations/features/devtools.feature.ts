import { colors } from "@mongez/copper";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

/**
 * `warlock add devtools` — the development dashboard at `/__warlock`.
 *
 * Installed as a DEV dependency and never named in `warlock.config.ts`: core
 * loads it on its own in development when it is installed. A production
 * install omits dev dependencies, so there is nothing to strip and no config
 * import that could fail to resolve.
 */
export const devtoolsFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/devtools as a dev dependency — a development-only dashboard at /__warlock (request timeline, queries, N+1, mailbox, logs, cache, routes). Loaded automatically by `warlock dev`; never runs in production.",
  devDependencies: {
    "@warlock.js/devtools": INSTALLED_WARLOCK_VERSION,
  },
  async onExecuting() {
    console.log(
      `${colors.green("✓")} Devtools installed. Run ${colors.cyan("warlock dev")} and open ${colors.cyan("/__warlock")} on your app's URL.`,
    );
  },
};
