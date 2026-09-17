import { colors } from "@mongez/copper";
import { fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";
import { rootPath } from "../../utils";
import { insertConnectorEntry } from "./shared/insert-connector-entry";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

const sitemapConfigStub = `import type { SitemapConfig } from "@warlock.js/sitemap";

/**
 * Runtime sitemap.xml generation. Requires the application's public origin —
 * set \`app.publicUrl\` in src/config/app.ts, or the PUBLIC_APP_URL
 * environment variable — or boot refuses to start while this is enabled.
 */
const sitemapConfig: SitemapConfig = {
  enabled: true,
  path: "/sitemap.xml",
  defaults: { changefreq: "weekly", priority: 0.5 },
};

export default sitemapConfig;
`;

/** Register the sitemap connector in the app-owned configuration without reformatting it. */
async function registerSitemapConnector(): Promise<void> {
  const configPath = rootPath("warlock.config.ts");

  if (!(await fileExistsAsync(configPath))) {
    console.log(
      `${colors.yellowBright("warlock.config.ts")} not found — add this yourself:\n` +
        `  import { sitemapConnector } from "@warlock.js/sitemap";\n` +
        `  export default defineConfig({ connectors: [sitemapConnector()] });`,
    );

    return;
  }

  const current = await getFileAsync(configPath);

  if (current.includes("sitemapConnector")) {
    console.log(`${colors.yellowBright("sitemapConnector")} already registered, skipping...`);

    return;
  }

  const importLine = 'import { sitemapConnector } from "@warlock.js/sitemap";';
  let next = current.includes(importLine) ? current : `${importLine}\n${current}`;

  const insertion = insertConnectorEntry(next, "sitemapConnector()");

  if (insertion.status === "already-present") {
    return;
  }

  if (insertion.status === "added") {
    next = insertion.next;
  } else if (next.includes("defineConfig({")) {
    next = next.replace(
      "defineConfig({",
      "defineConfig({\n  connectors: [sitemapConnector()],\n",
    );
  } else {
    console.log(
      `${colors.yellowBright("warlock.config.ts")} has no recognisable defineConfig({...}) — ` +
        "add `connectors: [sitemapConnector()]` yourself.",
    );

    return;
  }

  await putFileAsync(configPath, next);
  console.log(`${colors.green("✓")} Registered sitemapConnector in warlock.config.ts`);
  console.log(
    "Next: set `app.publicUrl` (src/config/app.ts) or the PUBLIC_APP_URL environment " +
      "variable — the sitemap route refuses to boot without it.",
  );
}

/** `warlock add sitemap` — runtime sitemap.xml generation, backed by the page registry. */
export const sitemapFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/sitemap — runtime sitemap.xml generation from the page registry. Creates src/config/sitemap.ts and registers sitemapConnector() in warlock.config.ts. Requires app.publicUrl (or PUBLIC_APP_URL) to be set.",
  requires: ["web"],
  dependencies: {
    "@warlock.js/sitemap": INSTALLED_WARLOCK_VERSION,
  },
  ejectConfig: {
    content: sitemapConfigStub,
    name: "sitemap",
  },
  onExecuting: registerSitemapConnector,
};
