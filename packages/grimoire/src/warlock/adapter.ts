/**
 * The Warlock adapter: turns core's inspect report into the book's facts.
 * It never parses app source itself: files come from `collectFiles()`,
 * routes, events and jobs from `inspectApp()` after the `warlock inspect`
 * boot pass, pages from `inspectApp()` (the web page graph, no boot), and
 * mobile apps from their folders.
 *
 * `@warlock.js/core/tooling` is imported inside the methods, never at the
 * top: this module is reached from `warlock.config.ts`.
 */
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  InspectFile,
  InspectOptions,
  InspectReport,
  InspectRoute,
  InspectSection,
} from "@warlock.js/core/tooling";
import type {
  BookAdapter,
  BookFile,
  BookHost,
  BookMobileApp,
  BookNamedThing,
  BookPage,
  BookRoute,
  BookSite,
} from "../contracts/adapter";
import { isCodeFile, isInsideFolder, toPosixPath } from "../paths";
import { WARLOCK_LOGO_DATA_URI } from "./logo";
import { collectMobileFacts, type MobileAppOption } from "./mobile-facts";
import { readAppLanguages } from "./languages";

/**
 * Reads the sections of the inspect report that need the app booted
 * (`routes`, `events`, `jobs`) for the project at `root`. The default boots
 * the app once, the `warlock inspect` way (connectors boot, none starts).
 * `warlock mcp` passes its own, which shares the server's boot.
 */
export type WarlockInspect = (
  root: string,
  sections: readonly InspectSection[],
) => Promise<InspectReport>;

/** Options of `createWarlockAdapter()`. */
export type WarlockAdapterOptions = {
  /**
   * Mobile apps in the repository: folder, id and routing. Default: every
   * top-level folder with an `app.json` or an `app.config.*` file; it is
   * file-routed when its `package.json` lists `expo-router` (screens come
   * from the files), and code-navigated otherwise (no screens: the agent
   * declares them in `grimoire/apps/<app>/screens/`).
   */
  mobile?: readonly MobileAppOption[];
  /** How the booted sections are read. Default: the `warlock inspect` boot pass, run at most once. Pages never boot. */
  inspect?: WarlockInspect;
  /**
   * Read the route, event and job facts from the registries of the running process instead of booting the app
   * (`inspect` wins when both are set). For code that runs inside `warlock dev`, such as the devtools panel;
   * nothing is booted and no module is loaded twice. Default `false`.
   */
  live?: boolean;
};

/** The `version` of a `package.json` named `name`, or `null` when the file is not that package's. */
function versionIn(file: string, name: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };

    return manifest.name === name && typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * The installed version of a package, read from its `package.json` without
 * going through its `exports` (published `@warlock.js/core` exports neither
 * `./package.json` nor a `require` condition). It resolves the package's
 * entry and walks up to the `package.json` with that name; when the entry
 * cannot be resolved, it looks in each `node_modules` above `from`.
 *
 * @param from Absolute folder to look from.
 * @param resolve Resolves a bare specifier to a file URL or path (`import.meta.resolve`).
 */
export function installedVersion(
  name: string,
  from: string,
  resolve: ((specifier: string) => string) | undefined,
): string | null {
  try {
    const entry = resolve?.(name);

    if (entry !== undefined) {
      let folder = path.dirname(entry.startsWith("file:") ? fileURLToPath(entry) : entry);

      for (;;) {
        const version = versionIn(path.join(folder, "package.json"), name);

        if (version !== null) return version;

        const parent = path.dirname(folder);

        if (parent === folder) break;

        folder = parent;
      }
    }
  } catch {
    // Not resolvable from here: look in the node_modules folders below.
  }

  for (let folder = from; ; folder = path.dirname(folder)) {
    const version = versionIn(
      path.join(folder, "node_modules", ...name.split("/"), "package.json"),
      name,
    );

    if (version !== null) return version;
    if (path.dirname(folder) === folder) return null;
  }
}

/** The framework version, for the book manifest (a core upgrade rebuilds the book). */
function coreVersion(): string {
  const resolve =
    typeof import.meta.resolve === "function"
      ? (specifier: string) => import.meta.resolve(specifier)
      : undefined;

  return (
    installedVersion("@warlock.js/core", path.dirname(fileURLToPath(import.meta.url)), resolve) ??
    "unknown"
  );
}

/** The app's own `name` and `version` from `<root>/package.json`, or `null` when it has no name. */
export function appIdentity(root: string): { name: string; version: string | null } | null {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
    };

    return typeof manifest.name === "string" && manifest.name !== ""
      ? {
          name: manifest.name,
          version: typeof manifest.version === "string" ? manifest.version : null,
        }
      : null;
  } catch {
    return null;
  }
}

/** The Warlock.js brand (logo and installed version) and the app at `root`, for the view's header and footer. */
export function warlockHost(root: string, frameworkVersion: string): BookHost {
  return {
    name: "Warlock.js",
    version: frameworkVersion === "unknown" ? null : frameworkVersion,
    logo: WARLOCK_LOGO_DATA_URI,
    app: appIdentity(root),
  };
}

/** Run `work` with `console.log`/`info`/`debug` on stderr, so a boot never mixes with `--json` output. */
async function withConsoleOnStderr<T>(work: () => Promise<T>): Promise<T> {
  const { log, info, debug } = console;
  const toStderr = (...args: unknown[]) => console.error(...args);

  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;

  try {
    return await work();
  } finally {
    console.log = log;
    console.info = info;
    console.debug = debug;
  }
}

/** The default booted `inspect`: one boot pass, shared by every call. */
function bootedInspect(): WarlockInspect {
  let boot: Promise<unknown> | undefined;

  return async (root, sections) => {
    const tooling = await import("@warlock.js/core/tooling");

    boot ??= withConsoleOnStderr(() => tooling.bootForInspect(root));

    const booted = (await boot) as Awaited<ReturnType<typeof tooling.bootForInspect>>;

    if (!booted.context.booted) {
      const failures = booted.context.moduleFailures.map(
        (failure) => `${failure.file}: ${failure.message}`,
      );

      throw new Error(
        `the app did not boot${failures.length > 0 ? ` (${failures.join("; ")})` : ""}. Run warlock doctor to see why.`,
      );
    }

    return tooling.inspectApp({ ...tooling.inspectOptionsFromBoot(booted), cwd: root, sections });
  };
}

/** The slice of `@warlock.js/core/tooling` that {@link liveInspect} reads (a seam for specs). */
export type LiveInspectTooling = {
  inspectApp: (options: InspectOptions) => Promise<InspectReport>;
  liveInspectOptions: () => InspectOptions;
};

/**
 * The `inspect` for code running inside the app's own process (`warlock dev`): reads the live router and the
 * event listeners recorded since dev start. It never boots a connector and never imports the route or event
 * modules again, so the running app is not touched.
 */
export function liveInspect(
  load: () => Promise<LiveInspectTooling> = () => import("@warlock.js/core/tooling"),
): WarlockInspect {
  return async (root, sections) => {
    const tooling = await load();

    return tooling.inspectApp({ ...tooling.liveInspectOptions(), cwd: root, sections });
  };
}

/** `send-receipt.job.ts` → `send-receipt` (the stem without the role suffix). */
function stemOf(file: string, ...suffixes: string[]): string {
  const base = path.posix.basename(file).replace(/\.(?:d\.ts|[cm]?[jt]sx?)$/, "");

  for (const suffix of suffixes) {
    if (base.endsWith(`.${suffix}`)) return base.slice(0, -suffix.length - 1);
  }

  return base;
}

/**
 * The book's role of a file: the framework's role, with CLI command files
 * (`*.command.ts`, or a file directly in `<module>/commands/`) told apart from
 * plain source.
 */
export function bookRole(file: Pick<InspectFile, "file" | "role">): string {
  if (file.role !== "source") return file.role;

  const stem = path.posix.basename(file.file).replace(/\.(?:d\.ts|[cm]?[jt]sx?)$/, "");
  const folders = file.file.split("/").slice(0, -1);

  return stem.endsWith(".command") || (folders.length === 4 && folders[3] === "commands")
    ? "command"
    : file.role;
}

function toBookFile(file: InspectFile, mobile: readonly BookMobileApp[]): BookFile {
  const docs = file.exportDocs ?? {};
  const app = mobile.find((item) => isInsideFolder(file.file, item.root));

  return {
    file: file.file,
    module: file.module,
    type: bookRole(file),
    lines: file.lines ?? 0,
    about: file.about ?? null,
    tags: file.tags ?? {},
    exports: file.exports.map((name) => ({ name, about: docs[name] ?? null })),
    imports: file.imports.map((entry) =>
      entry.typeOnly === true
        ? { specifier: entry.specifier, file: entry.file, typeOnly: true }
        : { specifier: entry.specifier, file: entry.file },
    ),
    importedBy: [...file.importedBy],
    mobileApp: app?.id ?? null,
  };
}

/** Files by the names they export, built once per `routes()` call. */
type ExportIndex = () => ReadonlyMap<string, readonly string[]>;

function exportIndex(files: ReadonlyMap<string, BookFile>): ExportIndex {
  let index: Map<string, string[]> | undefined;

  return () => {
    if (index) return index;

    index = new Map();

    for (const file of files.values()) {
      for (const entry of file.exports) {
        const list = index.get(entry.name) ?? [];

        list.push(file.file);
        index.set(entry.name, list);
      }
    }

    return index;
  };
}

/** The file that defines a route's handler: the controller's file for a tuple, else the file exporting the handler. */
function handlerFileOf(
  route: InspectRoute,
  files: ReadonlyMap<string, BookFile>,
  pages: readonly BookPage[],
  exporters: ExportIndex,
): string | null {
  if (route.isPage) {
    return pages.find((page) => page.route === route.path)?.file ?? null;
  }

  const exportsName = (file: string | null | undefined, name: string): boolean =>
    file !== null &&
    file !== undefined &&
    files.get(file)?.exports.some((entry) => entry.name === name) === true;
  const imported =
    route.sourceFile === null
      ? []
      : (files.get(route.sourceFile)?.imports ?? []).map((entry) => entry.file);
  const name = route.controller ?? route.handler;

  if (!name || name === "anonymous") return null;

  const fromImports = imported.find((file) => exportsName(file, name));

  if (fromImports) return fromImports;
  if (exportsName(route.sourceFile, name)) return route.sourceFile;

  // Not imported by the routes file: the one file in the project exporting it, when there is only one.
  const anywhere = [...new Set(exporters().get(name) ?? [])];

  return anywhere.length === 1 ? (anywhere[0] ?? null) : null;
}

function toBookRoute(
  route: InspectRoute,
  files: ReadonlyMap<string, BookFile>,
  pages: readonly BookPage[],
  exporters: ExportIndex,
): BookRoute {
  const controller = route.controller ?? null;
  const action = route.action ?? null;
  const handler =
    controller !== null && action !== null && !route.handler.includes(".")
      ? `${controller}.${action}`
      : route.handler;

  return {
    method: route.method.toUpperCase(),
    path: route.path,
    name: route.name,
    sourceFile: route.sourceFile === null ? null : toPosixPath(route.sourceFile),
    handler,
    controller,
    action,
    handlerFile: handlerFileOf(route, files, pages, exporters),
    middleware: [...route.middleware],
    auth: { required: route.auth.required, userTypes: [...route.auth.userTypes] },
    isPage: route.isPage,
    description: route.description,
  };
}

async function folderNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The site folders of a multi-site app (`src/web/$sites/<id>`), sorted; empty for a single site. */
function siteFolders(root: string): Promise<string[]> {
  return folderNames(path.join(root, "src", "web", "$sites"));
}

/** `web.sites` from the loaded config, or `undefined` when `src/config/web.ts` is not loaded. */
async function webSitesConfig(): Promise<
  Record<string, { basePath?: unknown } | undefined> | undefined
> {
  const { config } = await import("@warlock.js/core");
  const sites: unknown = config.key("web.sites");

  return typeof sites === "object" && sites !== null
    ? (sites as Record<string, { basePath?: unknown }>)
    : undefined;
}

/**
 * Folders of a mobile app that hold native projects, build output or tool
 * caches, never app source. `node_modules` and dot folders are skipped too.
 */
const MOBILE_SKIPPED_FOLDERS = new Set([
  "android",
  "ios",
  "build",
  "dist",
  "web-build",
  "coverage",
  "node_modules",
]);

/**
 * The source folders of a mobile app: its top-level folders minus native
 * projects and build output (`android/`, `ios/` with Pods and builds can hold
 * hundreds of megabytes). Code files directly in the app folder (`App.tsx`)
 * are not folders; {@link mobileTopFiles} lists them.
 */
async function mobileSourceFolders(root: string, app: BookMobileApp): Promise<string[]> {
  return (await folderNames(path.join(root, ...app.root.split("/"))))
    .filter((name) => !name.startsWith(".") && !MOBILE_SKIPPED_FOLDERS.has(name))
    .map((name) => `${app.root}/${name}`);
}

/** Code files directly in a mobile app folder (`App.tsx`, `index.ts`), without tool configs and type shims. */
async function mobileTopFiles(root: string, app: BookMobileApp): Promise<string[]> {
  try {
    return (await readdir(path.join(root, ...app.root.split("/")), { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.name.startsWith(".") &&
          isCodeFile(entry.name) &&
          !entry.name.endsWith(".d.ts") &&
          !/\.config\.[^.]+$/.test(entry.name),
      )
      .map((entry) => `${app.root}/${entry.name}`)
      .sort();
  } catch {
    return [];
  }
}

/** The adapter over `inspectApp()`, `collectFiles()` and the mobile app folders. */
export function createWarlockAdapter(options: WarlockAdapterOptions = {}): BookAdapter {
  const inspect = options.inspect ?? (options.live === true ? liveInspect() : bootedInspect());
  const mobileOptions = options.mobile === undefined ? {} : { mobile: options.mobile };
  let lastFiles: { root: string; files: BookFile[] } | null = null;
  let lastPages: { root: string; pages: BookPage[] } | null = null;

  const mobileApps = (root: string) => collectMobileFacts(root, mobileOptions);

  /** `src` and each mobile app's source folders: what `files()` reads and the book fingerprints. */
  async function sourceFolders(root: string, mobile: readonly BookMobileApp[]): Promise<string[]> {
    const folders = await Promise.all(mobile.map((app) => mobileSourceFolders(root, app)));

    return ["src", ...folders.flat()];
  }

  async function files(root: string): Promise<BookFile[]> {
    const { collectFiles } = await import("@warlock.js/core/tooling");
    const mobile = await mobileApps(root);
    const dirs = await sourceFolders(root, mobile);
    const topFiles = (await Promise.all(mobile.map((app) => mobileTopFiles(root, app)))).flat();
    const collected = collectFiles(root, [], { dirs, files: topFiles })
      .filter((file) => isCodeFile(file.file))
      .map((file) => toBookFile(file, mobile));

    lastFiles = { root, files: collected };

    return collected;
  }

  /** File facts for the routes: the last `files()` answer, else the book's cache, else a new scan. */
  async function currentFiles(root: string): Promise<BookFile[]> {
    if (lastFiles?.root === root) return lastFiles.files;

    const { loadBook } = await import("../book");
    const book = await loadBook(root);

    return book?.facts.files ?? files(root);
  }

  async function pages(root: string): Promise<BookPage[]> {
    // A multi-site app's routes depend on `web.sites` (base paths), which only `src/config/web.ts` holds.
    if ((await siteFolders(root)).length > 0 && (await webSitesConfig()) === undefined) {
      throw new Error(
        "This app has several sites (src/web/$sites), and their page routes need src/config/web.ts, which is not loaded. Run the command through the warlock CLI, which loads it.",
      );
    }

    // Pages come from the web page graph: files only, never a boot.
    const { inspectApp } = await import("@warlock.js/core/tooling");
    const report = await inspectApp({ cwd: root, sections: ["pages"] });
    const found = (report.pages ?? []).map((page): BookPage => ({
      site: page.site ?? "default",
      route: page.path,
      name: page.name,
      file: toPosixPath(page.file),
      setupFile: page.setupFile === null ? null : toPosixPath(page.setupFile),
      layouts: page.layouts.map(toPosixPath),
      loaders: page.loaders.map(toPosixPath),
      actions: [...page.actions],
      requires: page.guard === null ? [] : [page.guard],
      reachedFrom: null,
    }));

    lastPages = { root, pages: found };

    return found;
  }

  return {
    name: "warlock",
    version: coreVersion(),
    host: (root) => warlockHost(root, coreVersion()),
    languages: (root) => readAppLanguages(root),
    async sourceRoots(root) {
      return sourceFolders(root, await mobileApps(root));
    },
    files,
    async routes(root) {
      const report = await inspect(root, ["routes"]);
      const known = new Map((await currentFiles(root)).map((file) => [file.file, file]));
      // Pages only name the file of a page route; a page problem is reported by `pages()` itself.
      const sitePages =
        lastPages?.root === root ? lastPages.pages : await pages(root).catch(() => []);

      const exporters = exportIndex(known);

      return (report.routes ?? []).map((route) => toBookRoute(route, known, sitePages, exporters));
    },
    async named(root) {
      const report = await inspect(root, ["events", "jobs", "schedules"]);
      const known = await currentFiles(root);
      const ofType = (type: string) => known.filter((file) => file.type === type);
      const named: BookNamedThing[] = [];

      // `*.mail.ts`, `*.email.ts` and the files of a `mails/` or `emails/` folder are all typed as mails.
      for (const file of ofType("mail")) {
        named.push({
          type: "mail",
          name: stemOf(file.file, "mail", "email"),
          file: file.file,
        });
      }

      const jobFiles = ofType("job");
      const jobFileOf = (name: string): string | null =>
        jobFiles.find((item) => {
          const stem = stemOf(item.file, "job");

          return name === stem || name.endsWith(`.${stem}`) || name.endsWith(`/${stem}`);
        })?.file ?? null;
      const seen = new Set<string>();

      // Queue jobs (`defineJob()`) and scheduled tasks are both jobs a flow can name.
      for (const name of [
        ...(report.jobs ?? []).map((job) => job.name),
        ...(report.schedules ?? []).map((schedule) => schedule.name),
      ]) {
        if (seen.has(name)) continue;

        seen.add(name);
        named.push({ type: "job", name, file: jobFileOf(name) });
      }

      // A job file the registries do not list is still a job by its file name.
      for (const file of jobFiles) {
        const name = stemOf(file.file, "job");

        if (seen.has(name) || [...seen].some((item) => jobFileOf(item) === file.file)) continue;

        seen.add(name);
        named.push({ type: "job", name, file: file.file });
      }

      for (const event of report.events ?? []) {
        const source = event.listeners[0]?.sourceFile;

        named.push({
          type: "event",
          name: event.event,
          file: source === undefined ? null : toPosixPath(source),
        });
      }

      for (const file of known) {
        if (/\.notification\.[cm]?[jt]sx?$/.test(file.file)) {
          named.push({
            type: "notification",
            name: stemOf(file.file, "notification"),
            file: file.file,
          });
        }
      }

      return named;
    },
    async sites(root): Promise<BookSite[]> {
      const multi = await siteFolders(root);

      if (multi.length > 0) {
        const configured = await webSitesConfig();

        return multi.map((id) => {
          const basePath: unknown = configured?.[id]?.basePath;

          return {
            id,
            root: `src/web/$sites/${id}`,
            basePath: typeof basePath === "string" ? basePath : null,
          };
        });
      }

      return (await folderNames(path.join(root, "src"))).includes("web")
        ? [{ id: "default", root: "src/web", basePath: null }]
        : [];
    },
    pages,
    mobile: mobileApps,
    async tests(root) {
      const known = await currentFiles(root);
      const specs = known.filter((file) => file.type === "spec").map((file) => file.file);
      const outside: string[] = [];

      const walk = async (dir: string, pattern: RegExp): Promise<void> => {
        let entries;

        try {
          entries = await readdir(path.join(root, dir), { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

          const relative = `${dir}/${entry.name}`;

          if (entry.isDirectory()) await walk(relative, pattern);
          else if (entry.isFile() && pattern.test(entry.name)) outside.push(relative);
        }
      };

      await walk("e2e", /\.e2e\.(?:ts|mts|js|mjs)$/);
      await walk("tests", /\.(?:test|spec)\.ts$/);

      return [...new Set([...specs, ...outside])].sort();
    },
  };
}
