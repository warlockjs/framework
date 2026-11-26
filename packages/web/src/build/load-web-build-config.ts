import { existsSync, realpathSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SitesConfig } from "../sites/site-config.types";

/** The build-safe web configuration: site routing facts and font declarations. */
export type WebBuildConfig = {
  sites?: SitesConfig;
  fonts?: readonly import("../fonts/types").WebFont[];
  moduleBoundary?: "error" | "warn" | "off";
  /** `app.localeCodes`, so the build can check route locale files the way boot does. */
  localeCodes?: readonly string[];
};

type Esbuild = typeof import("esbuild");

function staticSites(sites: SitesConfig | undefined): SitesConfig | undefined {
  if (sites === undefined) return undefined;

  return Object.fromEntries(
    Object.entries(sites).map(([key, site]) => [
      key,
      {
        ...("hosts" in site ? { hosts: [...site.hosts] } : { dynamic: true as const }),
        ...(site.basePath === undefined ? {} : { basePath: site.basePath }),
        ...(site.localeRouting === undefined ? {} : { localeRouting: { ...site.localeRouting } }),
      },
    ]),
  );
}

/**
 * esbuild ships with `@warlock.js/core`, not with web. Under pnpm it is only
 * reachable from core's own directory, so look there (the app's installed
 * core, found by walking up from the app), then from the app, then from web.
 */
function resolveEsbuild(appRoot: string): string {
  const fromDirectories: string[] = [];

  for (let directory = appRoot; ; directory = path.dirname(directory)) {
    const core = path.join(directory, "node_modules", "@warlock.js", "core");
    if (existsSync(core)) fromDirectories.push(realpathSync(core));
    if (path.dirname(directory) === directory) break;
  }
  fromDirectories.push(appRoot);

  for (const directory of fromDirectories) {
    try {
      return createRequire(path.join(directory, "package.json")).resolve("esbuild");
    } catch {
      // Not reachable from here; try the next place.
    }
  }

  return createRequire(import.meta.url).resolve("esbuild");
}

/**
 * The production builder statically imports every `src/config/*.ts` file into
 * its generated config-loader. Its build hooks run before that generated module
 * is evaluated, so this loads the one config value needed to shape the client
 * and barrel inputs.
 *
 * `web.ts` is bundled first, not imported as-is: it usually imports app code
 * (a `resolveHost` from `app/...`), and those tsconfig path aliases mean
 * nothing to Node. esbuild resolves them; packages stay external, so the app's
 * own `@warlock.js/*` instances are the ones that run. The bundle is written
 * inside the app so those package imports resolve from its `node_modules`.
 */
export async function loadWebBuildConfig(appRoot: string): Promise<WebBuildConfig> {
  const webModule = await importConfigModule<WebBuildConfig>(appRoot, ["web.ts", "web.tsx"]);
  // The app config may read environment values that only exist at boot; when it
  // cannot be loaded here the build checks route locales without the codes, as before.
  const appModule = await importConfigModule<{ localeCodes?: unknown }>(appRoot, [
    "app.ts",
    "app.tsx",
  ]).catch(() => undefined);
  const codes = appModule?.localeCodes;
  const localeCodes =
    Array.isArray(codes) && codes.every((code) => typeof code === "string")
      ? (codes as string[])
      : undefined;

  if (webModule === undefined) return localeCodes === undefined ? {} : { localeCodes };

  const moduleBoundary = webModule.moduleBoundary;

  return {
    sites: staticSites(webModule.sites),
    fonts: webModule.fonts,
    ...(moduleBoundary === "error" || moduleBoundary === "warn" || moduleBoundary === "off"
      ? { moduleBoundary }
      : {}),
    ...(localeCodes === undefined ? {} : { localeCodes }),
  };
}

/** Bundles one `src/config/<name>` file (the first that exists) and returns its default export. */
async function importConfigModule<T>(
  appRoot: string,
  names: readonly string[],
): Promise<T | undefined> {
  const configFile = names
    .map((name) => path.join(appRoot, "src", "config", name))
    .find(existsSync);

  if (configFile === undefined) return undefined;

  const esbuild = (await import(pathToFileURL(resolveEsbuild(appRoot)).href)) as Esbuild & {
    default?: Esbuild;
  };
  const { build } = esbuild.default ?? esbuild;
  const tsconfig = path.join(appRoot, "tsconfig.json");
  const result = await build({
    entryPoints: [configFile],
    absWorkingDir: appRoot,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: `node${process.versions.node.split(".")[0]}`,
    write: false,
    logLevel: "silent",
    jsx: "automatic",
    ...(existsSync(tsconfig) ? { tsconfig } : {}),
  });

  const bundleDirectory = path.join(appRoot, ".warlock");
  const bundleFile = path.join(
    bundleDirectory,
    `web-build-config.${process.pid}.${Date.now()}.mjs`,
  );

  await mkdir(bundleDirectory, { recursive: true });
  await writeFile(bundleFile, result.outputFiles[0]!.text, "utf8");

  try {
    const module = (await import(pathToFileURL(bundleFile).href)) as { default?: T };

    return module.default;
  } finally {
    await unlink(bundleFile).catch(() => {});
  }
}
