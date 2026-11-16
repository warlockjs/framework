/**
 * The `mobile` facts of the Warlock adapter: mobile apps that live in the
 * same repository, with their screens when they use file-based routing.
 *
 * Reads file and folder names only (and `package.json` to see whether the app
 * uses Expo Router). It never parses app source and never imports
 * `@warlock.js/core`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BookMobileApp, BookScreen } from "../contracts/adapter";

/** One mobile app to look at: its folder, its id, and how it routes. */
export type MobileAppOption = { root: string; id?: string; routing?: "files" | "code" };

/** Options of `collectMobileFacts()`. */
export type CollectMobileFactsOptions = {
  /**
   * Mobile apps in the repository. Default: every top-level folder with an
   * `app.json` or an `app.config.*` file; it is file-routed when its
   * `package.json` lists `expo-router`, and code-navigated otherwise.
   */
  mobile?: readonly MobileAppOption[];
};

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const PLATFORM_SUFFIX = /\.(web|native|ios|android)$/;
const IGNORED_FOLDERS = new Set([
  "node_modules",
  ".git",
  ".expo",
  "dist",
  "build",
  "android",
  "ios",
]);

/** Code-point order, the same on every machine and locale. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);

    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));

    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasDependency(manifest: Record<string, unknown> | null, name: string): boolean {
  if (!manifest) return false;

  return ["dependencies", "devDependencies", "peerDependencies"].some((key) => {
    const group = manifest[key];

    return (
      group !== null && typeof group === "object" && name in (group as Record<string, unknown>)
    );
  });
}

async function isMobileFolder(dir: string): Promise<boolean> {
  if (await exists(path.join(dir, "app.json"))) return true;

  const entries = await fs.readdir(dir).catch(() => [] as string[]);

  return entries.some((entry) => /^app\.config\.(ts|js|mjs|cjs|json)$/.test(entry));
}

/** Top-level folders that look like a mobile app, with their routing. */
async function discover(root: string): Promise<MobileAppOption[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const found: MobileAppOption[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORED_FOLDERS.has(entry.name))
      continue;

    const dir = path.join(root, entry.name);

    if (!(await isMobileFolder(dir))) continue;

    const manifest = await readJson(path.join(dir, "package.json"));

    found.push({
      root: entry.name,
      routing: hasDependency(manifest, "expo-router") ? "files" : "code",
    });
  }

  return found.sort((left, right) => compare(left.root, right.root));
}

/** Every code file under a folder, as POSIX paths relative to it. */
async function walk(dir: string, base = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(dir, base), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const relative = base === "" ? entry.name : `${base}/${entry.name}`;

    if (entry.isDirectory()) {
      if (!IGNORED_FOLDERS.has(entry.name)) files.push(...(await walk(dir, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }

  return files;
}

/**
 * The route of a file under the routes folder, or `null` when it is not a
 * screen: `_layout`, `+not-found`, `+html`, `+native-intent`, API routes
 * (`name+api`), declaration and test files.
 */
function routeOf(relative: string): string | null {
  const extension = CODE_EXTENSIONS.find((item) => relative.endsWith(item));

  if (!extension || relative.endsWith(".d.ts")) return null;

  const withoutExtension = relative.slice(0, -extension.length).replace(PLATFORM_SUFFIX, "");
  const segments = withoutExtension.split("/");
  const name = segments[segments.length - 1] ?? "";

  if (name === "_layout" || name.startsWith("+") || name.endsWith("+api")) return null;
  if (/\.(spec|test)$/.test(name) || segments.includes("__tests__")) return null;

  const url = segments.filter((segment) => !/^\(.*\)$/.test(segment) && segment !== "index");

  return `/${url.join("/")}`;
}

/** `_layout` files that wrap a screen, outermost first. */
function layoutsOf(relative: string, layouts: ReadonlyMap<string, string>): string[] {
  const folders = relative.split("/").slice(0, -1);
  const result: string[] = [];
  const outermost = layouts.get("");

  if (outermost) result.push(outermost);

  folders.forEach((_folder, index) => {
    const layout = layouts.get(folders.slice(0, index + 1).join("/"));

    if (layout) result.push(layout);
  });

  return result;
}

async function screensOf(root: string, routesDir: string): Promise<BookScreen[]> {
  const files = (await walk(path.join(root, routesDir))).sort();
  const layouts = new Map<string, string>();

  for (const relative of files) {
    const extension = CODE_EXTENSIONS.find((item) => relative.endsWith(item));
    const name = extension ? relative.slice(0, -extension.length).replace(PLATFORM_SUFFIX, "") : "";

    if (name === "_layout" || name.endsWith("/_layout")) {
      const folder = name.slice(0, -"_layout".length).replace(/\/$/, "");

      if (!layouts.has(folder)) layouts.set(folder, `${routesDir}/${relative}`);
    }
  }

  const seen = new Set<string>();
  const screens: BookScreen[] = [];

  for (const relative of files) {
    const route = routeOf(relative);

    if (route === null) continue;

    // `home.tsx` and `home.web.tsx` are one screen.
    const stem = relative.replace(/\.[^./]+$/, "").replace(PLATFORM_SUFFIX, "");

    if (seen.has(stem)) continue;

    seen.add(stem);
    screens.push({
      route,
      file: `${routesDir}/${relative}`,
      layouts: layoutsOf(relative, layouts),
    });
  }

  return screens.sort(
    (left, right) => compare(left.route, right.route) || compare(left.file, right.file),
  );
}

/**
 * The mobile apps of the repository as `BookFacts.mobile`.
 *
 * A file-routed app (Expo Router: `app/` or `src/app/`) lists its screens
 * from the file names: groups `(tabs)` are not part of the route, `index` is
 * the folder's route, `[id]` stays as written, and `_layout`, `+not-found`,
 * `+html` and `+api` files are not screens. A code-navigated app has
 * `routing: "code"`, `routesDir: null` and no screens; the agent declares
 * them in `grimoire/apps/<app>/screens/`.
 *
 * @param root Absolute project root.
 */
export async function collectMobileFacts(
  root: string,
  options: CollectMobileFactsOptions = {},
): Promise<BookMobileApp[]> {
  const configured = options.mobile ?? (await discover(root));
  const apps: BookMobileApp[] = [];

  for (const item of configured) {
    const appRoot = item.root.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    const routing =
      item.routing ??
      (hasDependency(await readJson(path.join(root, appRoot, "package.json")), "expo-router")
        ? "files"
        : "code");
    let routesDir: string | null = null;
    let screens: BookScreen[] = [];

    if (routing === "files") {
      for (const candidate of ["app", "src/app"]) {
        if (await exists(path.join(root, appRoot, candidate))) {
          routesDir = `${appRoot}/${candidate}`;
          break;
        }
      }

      if (routesDir !== null) screens = await screensOf(root, routesDir);
    }

    apps.push({
      id: item.id ?? path.posix.basename(appRoot),
      root: appRoot,
      routing,
      routesDir,
      screens,
    });
  }

  return apps;
}
