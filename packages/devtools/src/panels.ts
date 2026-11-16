import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  DevtoolsPanel,
  DevtoolsPanelExport,
  DevtoolsPanelMethod,
  DevtoolsPanelRoute,
} from "./types";

/**
 * A validated panel: file paths are absolute strings and every list is
 * present, so the server never re-checks them per request.
 */
export type MountedDevtoolsPanel = {
  id: string;
  title: string;
  view: string;
  routes: readonly (DevtoolsPanelRoute & { method: DevtoolsPanelMethod })[];
  assets: Readonly<Record<string, string>>;
};

/**
 * Ids the dashboard already uses for its own tabs, API segments and URLs. A
 * panel's routes live under `<path>/api/<id>`, so these would collide.
 */
const RESERVED_PANEL_IDS = new Set([
  "agents",
  "ai",
  "api",
  "assets",
  "background",
  "docs",
  "logs",
  "mail",
  "mails",
  "panels",
  "queries",
  "requests",
  "routes",
  "stream",
]);

const PANEL_ID = /^[a-z][a-z0-9-]*$/;
const ASSET_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const METHODS = new Set<DevtoolsPanelMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** Content types for the files a panel may serve; anything else is sent as bytes. */
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** The content type a panel file is served with, from its served name. */
export function panelContentType(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

/** An absolute file path from a path or `file:` URL, or `undefined` for anything else. */
function toFilePath(value: unknown): string | undefined {
  if (value instanceof URL) return value.protocol === "file:" ? fileURLToPath(value) : undefined;
  if (typeof value !== "string" || value === "") return undefined;
  if (value.startsWith("file:")) return fileURLToPath(value);

  return path.isAbsolute(value) ? value : undefined;
}

function isFile(file: string): boolean {
  return existsSync(file) && statSync(file).isFile();
}

/**
 * Validates `value` as a panel and returns it ready to mount. Throws an
 * error that names the panel and what to change; `taken` maps the ids
 * already registered to their titles and receives this panel's id.
 */
export function checkDevtoolsPanel(
  value: unknown,
  taken: Map<string, string>,
): MountedDevtoolsPanel {
  const panel = (value ?? {}) as Partial<DevtoolsPanel>;
  const id = panel.id;

  if (typeof id !== "string" || !PANEL_ID.test(id)) {
    throw new Error(
      `A devtools panel needs an "id" of lower-case letters, digits and dashes that starts with a letter; got ${JSON.stringify(id)}.`,
    );
  }

  if (RESERVED_PANEL_IDS.has(id)) {
    throw new Error(
      `Devtools panel id "${id}" is used by the dashboard itself; give the panel another id.`,
    );
  }

  const existing = taken.get(id);

  if (existing !== undefined) {
    throw new Error(
      `Devtools panel id "${id}" is already registered by the "${existing}" panel; each panel needs its own id.`,
    );
  }

  if (typeof panel.title !== "string" || panel.title.trim() === "") {
    throw new Error(`Devtools panel "${id}" needs a "title" for its tab.`);
  }

  const view = toFilePath(panel.view);

  if (view === undefined) {
    throw new Error(
      `Devtools panel "${id}" needs a "view": an absolute path or file: URL of its browser module.`,
    );
  }

  if (!isFile(view)) {
    throw new Error(`The view module of devtools panel "${id}" was not found at ${view}.`);
  }

  // Two routes on one method and path would make the server refuse to start.
  const seen = new Set<string>();
  const routes = (panel.routes ?? []).map((route) => {
    const method = route.method ?? "GET";

    if (!METHODS.has(method)) {
      throw new Error(
        `Devtools panel "${id}" has a route with method "${String(method)}"; use GET, POST, PUT, PATCH or DELETE.`,
      );
    }

    if (typeof route.path !== "string" || (route.path !== "" && !route.path.startsWith("/"))) {
      throw new Error(
        `Devtools panel "${id}" has a route path ${JSON.stringify(route.path)}; use "" or a path starting with "/".`,
      );
    }

    if (typeof route.handler !== "function") {
      throw new Error(`Devtools panel "${id}" route ${method} "${route.path}" has no handler.`);
    }

    if (seen.has(`${method} ${route.path}`)) {
      throw new Error(
        `Devtools panel "${id}" lists route ${method} "${route.path}" twice; keep one.`,
      );
    }

    seen.add(`${method} ${route.path}`);

    return { ...route, method };
  });

  const assets: Record<string, string> = {};

  for (const [name, source] of Object.entries(panel.assets ?? {})) {
    if (!ASSET_NAME.test(name) || name === "view.js") {
      throw new Error(
        `Devtools panel "${id}" has an asset named ${JSON.stringify(name)}; use a plain file name other than "view.js".`,
      );
    }

    const file = toFilePath(source);

    if (file === undefined || !isFile(file)) {
      throw new Error(
        `The asset "${name}" of devtools panel "${id}" was not found at ${String(source)}; give an absolute path or file: URL.`,
      );
    }

    assets[name] = file;
  }

  taken.set(id, panel.title);

  return { id, title: panel.title, view, routes, assets };
}

/** Validates a list of panels; the first invalid or duplicate one throws. */
export function checkDevtoolsPanels(panels: readonly unknown[]): MountedDevtoolsPanel[] {
  const taken = new Map<string, string>();

  return panels.map((panel) => checkDevtoolsPanel(panel, taken));
}

/** Hooks `loadDevtoolsPanels` uses; replaced in specs. */
export type LoadDevtoolsPanelsOptions = {
  /** The app's root directory: bare specifiers resolve from here, `./` paths are relative to it. */
  root: string;
  /** Receives one line per entry that could not be loaded or was rejected. */
  warn: (message: string) => void;
  /** Ids already taken (the built-in panels), mapped to their titles. */
  taken?: ReadonlyMap<string, string>;
  /** Imports a module URL or specifier; defaults to a dynamic `import()`. */
  importModule?: (specifier: string) => Promise<unknown>;
};

/** The URL or specifier to import for a `panels` entry. */
function resolvePanelSpecifier(entry: string, root: string): string {
  if (entry.startsWith("./") || entry.startsWith("../") || path.isAbsolute(entry)) {
    return pathToFileURL(path.resolve(root, entry)).href;
  }

  try {
    // From the app root, so a package the app installed resolves even when
    // devtools itself cannot see it.
    return pathToFileURL(createRequire(path.join(root, "package.json")).resolve(entry)).href;
  } catch {
    return entry;
  }
}

/** The panels a module's default export describes. */
async function panelsOf(exported: DevtoolsPanelExport, root: string): Promise<readonly unknown[]> {
  const value = typeof exported === "function" ? await exported({ root }) : exported;

  return Array.isArray(value) ? value : [value];
}

/**
 * Loads the devtools `panels` option: imports each module entry, reads its
 * default export, and validates every panel. An entry that fails to load and
 * a panel that is invalid or reuses an id are reported through `warn` and
 * skipped, so one broken panel never stops the dashboard.
 */
export async function loadDevtoolsPanels(
  entries: readonly (string | DevtoolsPanel)[],
  options: LoadDevtoolsPanelsOptions,
): Promise<MountedDevtoolsPanel[]> {
  // `src/config/devtools.ts` is a plain object with no types: a single string would be read letter by letter.
  if (!Array.isArray(entries as unknown)) {
    options.warn(
      `The devtools "panels" option must be a list, such as panels: ["@warlock.js/grimoire/devtools"]; got ${JSON.stringify(entries)}. No panel was added.`,
    );

    return [];
  }

  const importModule = options.importModule ?? ((specifier: string) => import(specifier));
  const taken = new Map<string, string>(options.taken ?? []);
  const panels: MountedDevtoolsPanel[] = [];

  for (const entry of entries) {
    let candidates: readonly unknown[];

    try {
      if (typeof entry === "string") {
        const module = (await importModule(resolvePanelSpecifier(entry, options.root))) as {
          default?: DevtoolsPanelExport;
        };

        if (module.default === undefined) {
          throw new Error("the module has no default export");
        }

        candidates = await panelsOf(module.default, options.root);
      } else {
        candidates = [entry];
      }
    } catch (error) {
      options.warn(
        `Devtools panel module "${String(entry)}" could not be loaded: ${describe(error)}. Check that it is installed and listed correctly in the devtools "panels" option.`,
      );
      continue;
    }

    for (const candidate of candidates) {
      try {
        panels.push(checkDevtoolsPanel(candidate, taken));
      } catch (error) {
        options.warn(`${describe(error)} The panel was not added.`);
      }
    }
  }

  return panels;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
