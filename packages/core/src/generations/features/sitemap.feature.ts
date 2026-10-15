import { colors } from "@mongez/copper";
import { fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";
import { srcPath } from "../../utils";
import { mergeWebSitemapConfig } from "./shared/merge-web-sitemap-config";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

const NEXT_STEPS =
  "Next: set `app.publicUrl` (src/config/app.ts) or the PUBLIC_APP_URL environment " +
  "variable, then flip `sitemap.enabled` to true in src/config/web.ts.";

/**
 * Ships DISABLED because a sitemap needs this application's public origin and
 * a freshly generated app has no way to know it. Two steps to turn it on:
 *
 *   1. set `app.publicUrl` in src/config/app.ts, or the PUBLIC_APP_URL
 *      environment variable;
 *   2. flip `sitemap.enabled` to true here.
 *
 * With it enabled and no origin configured, generation REFUSES rather than
 * serving absolute URLs built from a guessed host — a sitemap pointing at
 * the wrong domain is worse than one that never starts, because nothing
 * downstream reports it.
 */
const freshWebConfigStub = `import type { WebSitemapConfig } from "@warlock.js/web/sitemap";

const webConfig: { sitemap: WebSitemapConfig } = {
  sitemap: {
    enabled: false,
    path: "/sitemap.xml",
    defaults: { changefreq: "weekly", priority: 0.5 },
  },
};

export default webConfig;
`;

/**
 * `warlock add sitemap` writes its policy into the app's \`src/config/web.ts\`,
 * under the \`sitemap\` key — there is no \`src/config/sitemap.ts\` and no
 * standalone connector to register; \`@warlock.js/web\` (already installed via
 * the \`web\` requirement) reads \`web.sitemap\` itself.
 *
 * Creates \`web.ts\` when the app does not have one yet; otherwise merges a
 * \`sitemap\` section into whatever is already there rather than clobbering it.
 */
async function installSitemapConfig(): Promise<void> {
  const configPath = srcPath("config/web.ts");

  if (!(await fileExistsAsync(configPath))) {
    await putFileAsync(configPath, freshWebConfigStub);
    console.log(`${colors.green("✓")} Created src/config/web.ts with a disabled sitemap section`);
    console.log(NEXT_STEPS);

    return;
  }

  const current = await getFileAsync(configPath);
  const merge = mergeWebSitemapConfig(current);

  if (merge.status === "already-present") {
    console.log(
      `${colors.yellowBright("sitemap")} already configured in src/config/web.ts, skipping...`,
    );

    return;
  }

  if (merge.status === "unrecognised") {
    console.log(
      `${colors.redBright("✗")} Could not safely add a \`sitemap\` section to ` +
        `${colors.yellowBright("src/config/web.ts")} — its exported config object was not ` +
        "recognised, so nothing was written. Add it yourself:\n" +
        '  sitemap: { enabled: false, path: "/sitemap.xml", defaults: { changefreq: "weekly", priority: 0.5 } },',
    );

    process.exitCode = 1;

    return;
  }

  await putFileAsync(configPath, merge.next);
  console.log(`${colors.green("✓")} Added a disabled \`sitemap\` section to src/config/web.ts`);
  console.log(NEXT_STEPS);
}

/** `warlock add sitemap` — runtime sitemap.xml generation, backed by the page registry. */
export const sitemapFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/sitemap — runtime sitemap.xml generation from the page registry. " +
    "Adds a disabled `sitemap` section to src/config/web.ts, creating the file if it doesn't " +
    "exist yet. Requires app.publicUrl (or PUBLIC_APP_URL) to be set.",
  requires: ["web"],
  dependencies: {
    "@warlock.js/sitemap": INSTALLED_WARLOCK_VERSION,
  },
  onExecuting: installSitemapConfig,
};
