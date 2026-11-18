import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEVTOOLS_BUILT_IN_PANELS } from "./production/contracts";
import type { DevtoolsMode, DevtoolsPanelInfo } from "./production/contracts";
import type {
  DevtoolsPanel,
  DevtoolsPanelEntry,
  DevtoolsPanelErrorSummary,
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
  /** The folder of images the panel serves; `null` when it declared none. */
  files: MountedPanelFiles | null;
  /** What a read-only share link of the panel opens; `null` when the panel cannot be shared. */
  share: MountedPanelShare | null;
  /** Whether the panel declared itself safe for the production monitor. */
  production: boolean;
};

/** A panel's folder of images, validated: an absolute directory and lower-case extensions. */
export type MountedPanelFiles = {
  dir: string;
  extensions: readonly string[];
};

/** A panel's shared view, validated. */
export type MountedPanelShare = {
  /** Absolute path of the shared view module. */
  view: string;
  /** Paths of the GET routes the shared page may call. */
  routes: readonly string[];
  /** Served names from `assets` the shared page may load. */
  assets: readonly string[];
  /** Whether the shared page may load images from `files`. */
  files: boolean;
};

/** The extensions a panel serves from `files` when it lists none. */
export const DEFAULT_PANEL_FILE_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
];

/** Extensions a panel may never serve from `files`: a browser runs or renders them as a page. */
const BLOCKED_FILE_EXTENSIONS = new Set([".svg", ".html", ".htm", ".js", ".mjs"]);

/**
 * Ids the dashboard already uses for its own tabs, API segments and URLs. A
 * panel's routes live under `<path>/api/<id>`, so these would collide.
 */
const RESERVED_PANEL_IDS = new Set([
  "account",
  "admin",
  "agents",
  "ai",
  "api",
  "assets",
  "auth",
  "background",
  "docs",
  "errors",
  "health",
  "instances",
  "jobs",
  "logs",
  "mail",
  "mails",
  "panels",
  "queries",
  "requests",
  "resources",
  "routes",
  "share",
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
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
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

  const files = checkPanelFiles(id, panel.files);
  const share = checkPanelShare(id, panel.share, routes, assets, files !== null);

  taken.set(id, panel.title);

  return {
    id,
    title: panel.title,
    view,
    routes,
    assets,
    files,
    share,
    production: panel.production === true,
  };
}

const FILE_EXTENSION = /^\.[a-z0-9]{1,16}$/;

/** Validates `files`; `null` when the panel declares none. */
function checkPanelFiles(
  id: string,
  value: DevtoolsPanel["files"] | null,
): MountedPanelFiles | null {
  // A panel that was mounted before carries `null` for "none".
  if (value === undefined || value === null) return null;

  if (typeof value !== "object") {
    throw new Error(
      `Devtools panel "${id}" has files that is not an object; use { dir: "/absolute/folder" }.`,
    );
  }

  const dir = toFilePath(value.dir);

  if (dir === undefined) {
    throw new Error(
      `Devtools panel "${id}" needs files.dir to be an absolute path or a file: URL; got ${String(value.dir)}.`,
    );
  }

  const given = value.extensions;

  if (given !== undefined && (!Array.isArray(given) || given.length === 0)) {
    throw new Error(
      `Devtools panel "${id}" has files.extensions that is not a list; use [".png", ".jpg"] or leave it out.`,
    );
  }

  for (const extension of given ?? []) {
    if (typeof extension !== "string" || !FILE_EXTENSION.test(extension)) {
      throw new Error(
        `Devtools panel "${id}" has files.extensions entry ${JSON.stringify(extension)}; use lower-case extensions that start with a dot, such as ".png".`,
      );
    }

    if (BLOCKED_FILE_EXTENSIONS.has(extension)) {
      throw new Error(
        `Devtools panel "${id}" lists files.extensions entry "${extension}", which can run as a page or script in the browser; remove it (images such as .png, .jpg, .webp and .gif are fine).`,
      );
    }
  }

  return { dir, extensions: [...(given ?? DEFAULT_PANEL_FILE_EXTENSIONS)] };
}

/** Validates `share` against the panel's own routes, assets and files. */
function checkPanelShare(
  id: string,
  value: DevtoolsPanel["share"] | null,
  routes: readonly { method: DevtoolsPanelMethod; path: string }[],
  assets: Readonly<Record<string, string>>,
  hasFiles: boolean,
): MountedPanelShare | null {
  // A panel that was mounted before carries `null` for "none".
  if (value === undefined || value === null) return null;

  if (typeof value !== "object") {
    throw new Error(
      `Devtools panel "${id}" has share that is not an object; use { view, routes }.`,
    );
  }

  const view = toFilePath(value.view);

  if (view === undefined) {
    throw new Error(
      `Devtools panel "${id}" needs share.view: an absolute path or file: URL of the shared view module.`,
    );
  }

  if (!isFile(view)) {
    throw new Error(`The share.view module of devtools panel "${id}" was not found at ${view}.`);
  }

  if (!Array.isArray(value.routes)) {
    throw new Error(
      `Devtools panel "${id}" needs share.routes: a list of the paths of its GET routes the shared page may call.`,
    );
  }

  const getPaths = routes.filter((route) => route.method === "GET").map((route) => route.path);

  for (const route of value.routes) {
    if (typeof route !== "string" || !getPaths.includes(route)) {
      throw new Error(
        `Devtools panel "${id}" lists share.routes entry ${JSON.stringify(route)}, which is not the path of one of its GET routes${getPaths.length > 0 ? `; use one of ${getPaths.map((path) => JSON.stringify(path)).join(", ")}` : " (the panel has no GET routes)"}.`,
      );
    }
  }

  for (const name of value.assets ?? []) {
    if (typeof name !== "string" || !Object.hasOwn(assets, name)) {
      throw new Error(
        `Devtools panel "${id}" lists share.assets entry ${JSON.stringify(name)}, which is not a name in its assets; use one of ${Object.keys(assets).join(", ") || "(the panel has no assets)"}.`,
      );
    }
  }

  const files = value.files === true;

  if (value.files !== undefined && typeof value.files !== "boolean") {
    throw new Error(`Devtools panel "${id}" needs share.files to be true or false.`);
  }

  if (files && !hasFiles) {
    throw new Error(
      `Devtools panel "${id}" sets share.files, but the panel has no files folder; add files: { dir } or remove share.files.`,
    );
  }

  return { view, routes: [...value.routes], assets: [...(value.assets ?? [])], files };
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
  /** Where the dashboard runs; panel factories receive it as `context.mode`. @default "development" */
  mode?: DevtoolsMode;
  /** The captured error groups of the last hour; panel factories receive it as `context.errors`. */
  errors?: () => Promise<readonly DevtoolsPanelErrorSummary[]>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/** What is wrong with a `[specifier, options]` entry, or `undefined` when it is valid. */
function tupleProblem(entry: readonly unknown[]): string | undefined {
  if (entry.length !== 2) {
    return `it has ${entry.length} item(s); use exactly [specifier, options]`;
  }

  if (typeof entry[0] !== "string" || entry[0] === "") {
    return `its first item is ${JSON.stringify(entry[0])}; use the module specifier as a string`;
  }

  if (!isPlainObject(entry[1])) {
    return `its second item is not a plain object; pass the options as { name: value }`;
  }

  return undefined;
}

/** The URL or specifier to import for a `panels` entry. */
function resolvePanelSpecifier(entry: string, root: string): string {
  if (entry.startsWith("./") || entry.startsWith("../") || path.isAbsolute(entry)) {
    return pathToFileURL(path.resolve(root, entry)).href;
  }

  return resolveFromNodeModules(entry, root) ?? resolveWithRequire(entry, root) ?? entry;
}

/** Picks the file an `exports` target names: `import`, then `default`, then `node`. */
function exportTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;

  if (Array.isArray(target)) {
    for (const item of target) {
      const found = exportTarget(item);

      if (found !== undefined) return found;
    }

    return undefined;
  }

  if (target !== null && typeof target === "object") {
    const conditions = target as Record<string, unknown>;

    for (const condition of ["import", "node", "default"]) {
      const found = exportTarget(conditions[condition]);

      if (found !== undefined) return found;
    }
  }

  return undefined;
}

/**
 * Resolves a package specifier by looking it up in the `node_modules` folders
 * above the app root and reading its `exports` map. `createRequire().resolve`
 * cannot do this for a package that only has an `import` condition.
 */
function resolveFromNodeModules(entry: string, root: string): string | undefined {
  const parts = entry.split("/");
  const nameLength = entry.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, nameLength).join("/");
  const subpath = parts.length > nameLength ? `./${parts.slice(nameLength).join("/")}` : ".";

  if (!name) return undefined;

  let directory = path.resolve(root);

  for (;;) {
    const packageDirectory = path.join(directory, "node_modules", name);
    const manifestFile = path.join(packageDirectory, "package.json");

    if (existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
          exports?: unknown;
          main?: string;
        };
        const exported = manifest.exports;
        const map =
          exported !== null && typeof exported === "object" && !Array.isArray(exported)
            ? (exported as Record<string, unknown>)
            : undefined;
        const hasSubpaths =
          map !== undefined && Object.keys(map).some((key) => key.startsWith("."));
        const target =
          exported === undefined
            ? subpath === "."
              ? (manifest.main ?? "index.js")
              : subpath
            : hasSubpaths
              ? exportTarget(map?.[subpath])
              : subpath === "."
                ? exportTarget(exported)
                : undefined;

        if (target === undefined) return undefined;

        const file = path.resolve(packageDirectory, target);

        return isFile(file) ? pathToFileURL(file).href : undefined;
      } catch {
        return undefined;
      }
    }

    const parent = path.dirname(directory);

    if (parent === directory) return undefined;

    directory = parent;
  }
}

/** The `require` resolution, for packages the `node_modules` lookup does not understand. */
function resolveWithRequire(entry: string, root: string): string | undefined {
  try {
    return pathToFileURL(createRequire(path.join(root, "package.json")).resolve(entry)).href;
  } catch {
    return undefined;
  }
}

/** The panels a module's default export describes. */
async function panelsOf(
  exported: DevtoolsPanelExport,
  root: string,
  mode: DevtoolsMode,
  panelOptions: Readonly<Record<string, unknown>> = {},
  errors?: () => Promise<readonly DevtoolsPanelErrorSummary[]>,
): Promise<readonly unknown[]> {
  const value =
    typeof exported === "function"
      ? await exported({ ...panelOptions, root, mode, ...(errors ? { errors } : {}) })
      : exported;

  return Array.isArray(value) ? value : [value];
}

/**
 * Loads the devtools `panels` option: imports each module entry, reads its
 * default export, and validates every panel. An entry that fails to load and
 * a panel that is invalid or reuses an id are reported through `warn` and
 * skipped, so one broken panel never stops the dashboard.
 */
export async function loadDevtoolsPanels(
  entries: readonly DevtoolsPanelEntry[],
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
  const mode = options.mode ?? "development";
  const taken = new Map<string, string>(options.taken ?? []);
  const panels: MountedDevtoolsPanel[] = [];

  for (const entry of entries) {
    let candidates: readonly unknown[];

    try {
      if (Array.isArray(entry as unknown)) {
        const problem = tupleProblem(entry as readonly unknown[]);

        if (problem !== undefined) {
          options.warn(
            `Devtools panels entry ${JSON.stringify(entry)} is invalid: ${problem}. Example: ["@warlock.js/grimoire/devtools", { ttlMs: 60000 }]. The entry was not added.`,
          );
          continue;
        }
      }

      if (typeof entry === "string" || Array.isArray(entry as unknown)) {
        const [specifier, panelOptions] =
          typeof entry === "string"
            ? [entry, undefined]
            : (entry as readonly [string, Record<string, unknown>]);
        const module = (await importModule(resolvePanelSpecifier(specifier, options.root))) as {
          default?: DevtoolsPanelExport;
        };

        if (module.default === undefined) {
          throw new Error("the module has no default export");
        }

        candidates = await panelsOf(
          module.default,
          options.root,
          mode,
          panelOptions,
          options.errors,
        );
      } else {
        candidates = [entry];
      }
    } catch (error) {
      options.warn(
        `Devtools panel module "${String(Array.isArray(entry as unknown) ? (entry as readonly unknown[])[0] : entry)}" could not be loaded: ${describe(error)}. Check that it is installed and listed correctly in the devtools "panels" option.`,
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

/** What `productionPanels` decides. */
export type DevtoolsProductionPanels = {
  /** Built-in tab ids shown, in display order. */
  builtIn: string[];
  /** Package panels shown. */
  panels: MountedDevtoolsPanel[];
};

/**
 * Which tabs the production monitor shows. A built-in tab follows
 * `DEVTOOLS_BUILT_IN_PANELS` unless `overrides[id]` says otherwise. A package
 * panel (the Processes panel included) shows when it declares
 * `production: true` or `overrides[id]` is `true`; `overrides[id]: false` turns
 * any tab off.
 */
export function productionPanels(
  packagePanels: readonly MountedDevtoolsPanel[],
  overrides: Readonly<Record<string, boolean>> = {},
): DevtoolsProductionPanels {
  const builtIn = DEVTOOLS_BUILT_IN_PANELS.filter((tab) => overrides[tab.id] ?? tab.production).map(
    (tab) => tab.id,
  );
  const panels = packagePanels.filter((panel) => overrides[panel.id] ?? panel.production);

  return { builtIn, panels };
}

/**
 * The tab list `GET api/panels` answers with: the built-in tabs in
 * `builtIn` (default: every one), in display order, then the package panels
 * in registration order.
 */
export function listPanelInfos(
  panels: readonly (Pick<MountedDevtoolsPanel, "id" | "title"> &
    Partial<Pick<MountedDevtoolsPanel, "share">>)[],
  builtIn?: readonly string[],
): DevtoolsPanelInfo[] {
  const tabs: DevtoolsPanelInfo[] = DEVTOOLS_BUILT_IN_PANELS.filter(
    (tab) => builtIn === undefined || builtIn.includes(tab.id),
  ).map((tab) => ({
    id: tab.id,
    title: tab.title,
    type: "built-in" as const,
    shareable: false,
  }));

  for (const panel of panels) {
    tabs.push({
      id: panel.id,
      title: panel.title,
      type: "package" as const,
      shareable: panel.share !== undefined && panel.share !== null,
    });
  }

  return tabs;
}
