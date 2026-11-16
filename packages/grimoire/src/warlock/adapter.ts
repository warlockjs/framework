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
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { InspectFile, InspectReport, InspectRoute, InspectSection } from "@warlock.js/core/tooling";
import type {
  BookAdapter,
  BookFile,
  BookMobileApp,
  BookNamedThing,
  BookPage,
  BookRoute,
  BookSite,
} from "../contracts/adapter";
import { isCodeFile, isInsideFolder, toPosixPath } from "../paths";
import { collectMobileFacts, type MobileAppOption } from "./mobile-facts";

/**
 * Reads the sections of the inspect report that need the app booted
 * (`routes`, `events`, `jobs`) for the project at `root`. The default boots
 * the app once, the `warlock inspect` way (connectors boot, none starts).
 * `warlock mcp` passes its own, which shares the server's boot.
 */
export type WarlockInspect = (root: string, sections: readonly InspectSection[]) => Promise<InspectReport>;

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
};

/** The framework version, for the book manifest. */
function coreVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require("@warlock.js/core/package.json") as { version?: unknown };

    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
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
      const failures = booted.context.moduleFailures.map((failure) => `${failure.file}: ${failure.message}`);

      throw new Error(
        `The app did not boot, so its routes could not be read${failures.length > 0 ? ` (${failures.join("; ")})` : ""}. Run warlock doctor to see why.`,
      );
    }

    return tooling.inspectApp({ ...tooling.inspectOptionsFromBoot(booted), cwd: root, sections });
  };
}

/** `send-receipt.job.ts` → `send-receipt` (the stem without the role suffix). */
function stemOf(file: string, suffix: string): string {
  const base = path.posix.basename(file).replace(/\.(?:d\.ts|[cm]?[jt]sx?)$/, "");

  return base.endsWith(`.${suffix}`) ? base.slice(0, -suffix.length - 1) : base;
}

function toBookFile(file: InspectFile, mobile: readonly BookMobileApp[]): BookFile {
  const docs = file.exportDocs ?? {};
  const app = mobile.find((item) => isInsideFolder(file.file, item.root));

  return {
    file: file.file,
    module: file.module,
    type: file.role,
    lines: file.lines ?? 0,
    about: file.about ?? null,
    tags: file.tags ?? {},
    exports: file.exports.map((name) => ({ name, about: docs[name] ?? null })),
    imports: file.imports.map((entry) => ({ specifier: entry.specifier, file: entry.file })),
    importedBy: [...file.importedBy],
    mobileApp: app?.id ?? null,
  };
}

/** The file that defines a route's handler: the controller's file for a tuple, else the file exporting the handler. */
function handlerFileOf(route: InspectRoute, files: ReadonlyMap<string, BookFile>, pages: readonly BookPage[]): string | null {
  if (route.isPage) {
    return pages.find((page) => page.route === route.path)?.file ?? null;
  }

  const exportsName = (file: string | null | undefined, name: string): boolean =>
    file !== null && file !== undefined && files.get(file)?.exports.some((entry) => entry.name === name) === true;
  const imported = route.sourceFile === null ? [] : (files.get(route.sourceFile)?.imports ?? []).map((entry) => entry.file);
  const name = route.controller ?? route.handler;

  if (!name || name === "anonymous") return null;

  const fromImports = imported.find((file) => exportsName(file, name));

  if (fromImports) return fromImports;
  if (exportsName(route.sourceFile, name)) return route.sourceFile;

  const anywhere = [...files.keys()].filter((file) => exportsName(file, name));

  return anywhere.length === 1 ? (anywhere[0] ?? null) : null;
}

function toBookRoute(route: InspectRoute, files: ReadonlyMap<string, BookFile>, pages: readonly BookPage[]): BookRoute {
  const controller = route.controller ?? null;
  const action = route.action ?? null;
  const handler =
    controller !== null && action !== null && !route.handler.includes(".") ? `${controller}.${action}` : route.handler;

  return {
    method: route.method.toUpperCase(),
    path: route.path,
    name: route.name,
    sourceFile: route.sourceFile === null ? null : toPosixPath(route.sourceFile),
    handler,
    controller,
    action,
    handlerFile: handlerFileOf(route, files, pages),
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
async function webSitesConfig(): Promise<Record<string, { basePath?: unknown } | undefined> | undefined> {
  const { config } = await import("@warlock.js/core");
  const sites: unknown = config.key("web.sites");

  return typeof sites === "object" && sites !== null ? (sites as Record<string, { basePath?: unknown }>) : undefined;
}

/** The adapter over `inspectApp()`, `collectFiles()` and the mobile app folders. */
export function createWarlockAdapter(options: WarlockAdapterOptions = {}): BookAdapter {
  const inspect = options.inspect ?? bootedInspect();
  const mobileOptions = options.mobile === undefined ? {} : { mobile: options.mobile };
  let lastFiles: { root: string; files: BookFile[] } | null = null;
  let lastPages: { root: string; pages: BookPage[] } | null = null;

  const mobileApps = (root: string) => collectMobileFacts(root, mobileOptions);

  async function files(root: string): Promise<BookFile[]> {
    const { collectFiles } = await import("@warlock.js/core/tooling");
    const mobile = await mobileApps(root);
    const dirs = ["src", ...mobile.map((app) => app.root)];
    const collected = collectFiles(root, [], { dirs })
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
    const found = (report.pages ?? []).map(
      (page): BookPage => ({
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
      }),
    );

    lastPages = { root, pages: found };

    return found;
  }

  return {
    name: "warlock",
    version: coreVersion(),
    async sourceRoots(root) {
      return ["src", ...(await mobileApps(root)).map((app) => app.root)];
    },
    files,
    async routes(root) {
      const report = await inspect(root, ["routes"]);
      const known = new Map((await currentFiles(root)).map((file) => [file.file, file]));
      // Pages only name the file of a page route; a page problem is reported by `pages()` itself.
      const sitePages = lastPages?.root === root ? lastPages.pages : await pages(root).catch(() => []);

      return (report.routes ?? []).map((route) => toBookRoute(route, known, sitePages));
    },
    async named(root) {
      const report = await inspect(root, ["events", "jobs"]);
      const known = await currentFiles(root);
      const ofType = (type: string) => known.filter((file) => file.type === type);
      const named: BookNamedThing[] = [];

      for (const file of ofType("mail")) named.push({ type: "mail", name: stemOf(file.file, "mail"), file: file.file });

      const jobFiles = ofType("job");
      const jobs = report.jobs ?? [];

      if (jobs.length > 0) {
        for (const job of jobs) {
          const file = jobFiles.find((item) => {
            const stem = stemOf(item.file, "job");

            return job.name === stem || job.name.endsWith(`.${stem}`) || job.name.endsWith(`/${stem}`);
          });

          named.push({ type: "job", name: job.name, file: file?.file ?? null });
        }
      } else {
        for (const file of jobFiles) named.push({ type: "job", name: stemOf(file.file, "job"), file: file.file });
      }

      for (const event of report.events ?? []) {
        const source = event.listeners[0]?.sourceFile;

        named.push({ type: "event", name: event.event, file: source === undefined ? null : toPosixPath(source) });
      }

      for (const file of known) {
        if (/\.notification\.[cm]?[jt]sx?$/.test(file.file)) {
          named.push({ type: "notification", name: stemOf(file.file, "notification"), file: file.file });
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

          return { id, root: `src/web/$sites/${id}`, basePath: typeof basePath === "string" ? basePath : null };
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
