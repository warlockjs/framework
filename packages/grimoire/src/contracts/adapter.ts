/**
 * The adapter contract: how a framework hands its facts to Grimoire.
 *
 * The root entry never reads application source on its own. An adapter (only
 * the Warlock one, `@warlock.js/grimoire/warlock`, ships today) turns the
 * framework's own report into these shapes. For Warlock that report is
 * `inspectApp()` from `@warlock.js/core/tooling`; the adapter is a mapping,
 * never a second parser.
 *
 * All paths are project-relative POSIX paths.
 */

/**
 * The role of a source file, from the framework's naming conventions. The
 * Warlock adapter passes `InspectFile.role` through unchanged; any other
 * string is allowed so a new role never breaks the book.
 */
export type BookFileType =
  | "controller"
  | "service"
  | "repository"
  | "model"
  | "use-case"
  | "seed"
  | "request"
  | "mail"
  | "job"
  | "event"
  | "client"
  | "migration"
  | "schema"
  | "resource"
  | "hook"
  | "component"
  | "util"
  | "type"
  | "config"
  | "locale"
  | "main"
  | "routes"
  | "worker"
  | "command"
  | "page"
  | "setup"
  | "layout"
  | "root"
  | "spec"
  | "source"
  | (string & {});

/** One public export of a file. */
export type BookExport = {
  /** Export name; `default` and `*` stand for default and star exports. */
  name: string;
  /** First sentence of the comment above the export, or `null`. */
  about: string | null;
};

/** One import of a file. */
export type BookImport = {
  /** The specifier as written (`../models/product.model`, `@warlock.js/core`). */
  specifier: string;
  /** The project file it resolves to, or `null` for a package or an unresolved alias. */
  file: string | null;
  /**
   * `true` when every import and re-export of the specifier in the file is
   * type-only (`import type`, `export type`, `import { type A }`); erased at
   * runtime. Absent for a value import, and in facts from older adapters.
   */
  typeOnly?: boolean;
};

/** Facts about one source file. Code files only (`.ts`, `.tsx`, `.js`, …). */
export type BookFile = {
  file: string;
  /** `src/app/<module>`, or the containing top-level folder (`src/config`, `mobile/app`). */
  module: string;
  type: BookFileType;
  lines: number;
  /** The header sentence (first sentence of the comment at the top of the file), or `null`. */
  about: string | null;
  /** `@tag value` lines of the header comment, by tag name without `@` (`{ feature: ["auth"] }`). */
  tags: Record<string, string[]>;
  exports: BookExport[];
  imports: BookImport[];
  /** Project files that import this one. */
  importedBy: string[];
  /** The mobile app id when the file belongs to a mobile app's root, otherwise `null`. */
  mobileApp: string | null;
};

/** One HTTP route. Mirrors `InspectRoute`, trimmed to what the book shows. */
export type BookRoute = {
  /** Uppercase method; `ALL` for a route on every method. */
  method: string;
  /** Path as registered (`/products/:id`). */
  path: string;
  name: string | null;
  /** The routes file that registered it, or `null`. */
  sourceFile: string | null;
  /** Handler function name, `Controller.action` for a controller tuple, `anonymous` when unnamed. */
  handler: string;
  /** Controller class name of a `[controller, "action"]` tuple, or `null`. */
  controller: string | null;
  action: string | null;
  /** The file that defines the handler (resolved by the adapter), or `null` when unknown. */
  handlerFile: string | null;
  /** Middleware names in run order. */
  middleware: string[];
  /** Whether a guard requires a signed-in user, and which user types it accepts (empty = any). */
  auth: { required: boolean; userTypes: string[] };
  /** Whether a page route registered it (the page itself is in `pages`). */
  isPage: boolean;
  description: string | null;
};

/**
 * One site of a web app. A single-site app has one site with id `default`
 * and root `src/web`; multi-site apps have one per `web.sites` key, rooted at
 * `src/web/$sites/<key>`.
 */
export type BookSite = {
  id: string;
  root: string;
  /** URL prefix of the site, or `null`. */
  basePath: string | null;
};

/** How a page can be reached from somewhere else. */
export type BookPageLink = {
  type: "link" | "redirect";
  /** The file that holds the link or redirect. */
  from: string;
  line: number;
};

/** One page of a site, from the web page graph (`discoverPageGraph`). */
export type BookPage = {
  /** Site id (`default` in a single-site app). */
  site: string;
  /** Route path (`/products/:id`). */
  route: string;
  name: string | null;
  /** The `*.page.tsx` file. */
  file: string;
  /** The `*.setup.ts` file holding the page's logic, or `null`. */
  setupFile: string | null;
  /** Layout files, outermost first. */
  layouts: string[];
  /** Files on the chain that export a loader. */
  loaders: string[];
  /** Action names (`default` for `action`). */
  actions: string[];
  /** What the page requires before it renders (`user`, middleware names). Empty when nothing. */
  requires: string[];
  /**
   * Links and redirects that point at this page, read as plain values.
   * `null` when the adapter cannot tell (shown as "unknown").
   */
  reachedFrom: BookPageLink[] | null;
};

/** One screen of a mobile app that uses file-based routing. */
export type BookScreen = {
  /** Route as the router derives it from the file (`/products/[id]`). */
  route: string;
  file: string;
  /** Layout files (`_layout.tsx`), outermost first. */
  layouts: string[];
};

/** A mobile app that lives in the same repository. */
export type BookMobileApp = {
  /** Id used by the book (`mobile`); the folder name of its root by default. */
  id: string;
  /** Project-relative root (`mobile`). */
  root: string;
  /**
   * `files`: screens come from the file structure (`screens` is filled).
   * `code`: navigation is defined in code; screens are declared by the agent
   * in `grimoire/apps/<app>/screens/` and `screens` is empty.
   */
  routing: "files" | "code";
  /** Folder that holds the file-based routes (`mobile/app`), or `null`. */
  routesDir: string | null;
  screens: BookScreen[];
};

/** The kinds of named thing a flow step may point at. */
export type BookNamedType = "mail" | "job" | "event" | "notification";

/** A mail, job, event or notification as code names it. */
export type BookNamedThing = {
  type: BookNamedType;
  /** The name a flow step uses (`order-confirmation`, `orders.shipped`). */
  name: string;
  /** The file that defines it, or `null` when only a registry knows it. */
  file: string | null;
};

/** Everything an adapter reports, as one value. The builder caches it. */
export type BookFacts = {
  files: BookFile[];
  /** `null` when route facts were never collected (no `routes()` or a file-only build). */
  routes: BookRoute[] | null;
  sites: BookSite[];
  pages: BookPage[];
  mobile: BookMobileApp[];
  named: BookNamedThing[];
  /** Test files to scan for `@proves` lines (inside and outside the source roots). */
  tests: string[];
};

/**
 * The framework the book was read from, and the app it describes. The
 * Grimoire view shows it in its header (framework logo and version) and at
 * the bottom (the app's own name and version); an adapter that supplies no
 * host shows nothing.
 */
export type BookHost = {
  /** Framework name (`Warlock.js`). */
  name: string;
  /** Installed framework version, or `null` when unknown. */
  version: string | null;
  /** Small logo as a `data:image/...` URI (kept inline so the static export stays one file), or `null`. */
  logo: string | null;
  /** The app's own name and version (its `package.json`), or `null`. */
  app: { name: string; version: string | null } | null;
};

/**
 * What a framework adapter provides. Only `files` and `sourceRoots` are
 * required; a missing method means "this framework has none of those".
 *
 * Every method receives the absolute project root. Only `routes` may load or
 * boot the application: the builder caches its result and calls it only when
 * the route cache is stale and the caller asked for fresh routes.
 */
export type BookAdapter = {
  /** Adapter name, stored in the book manifest (`warlock`). */
  name: string;
  /** Adapter version (the framework version); a change rebuilds the book. */
  version: string;
  /** Project-relative folders whose code files the book mirrors (`["src", "mobile"]`). */
  sourceRoots(root: string): Promise<string[]>;
  /** Facts for every code file under the source roots. Never executes app code. */
  files(root: string): Promise<BookFile[]>;
  /** HTTP routes. May boot the app. */
  routes?(root: string): Promise<BookRoute[]>;
  /**
   * Files whose change makes the route cache stale, given the current file
   * facts. Default (when absent): every `routes` file and everything it
   * imports, every `config` file, `warlock.config.ts` and `package.json`.
   */
  routeInputs?(root: string, files: readonly BookFile[]): Promise<string[]>;
  /** Sites of the web app. Static. */
  sites?(root: string): Promise<BookSite[]>;
  /** Pages of every site. Static (reads files only). */
  pages?(root: string): Promise<BookPage[]>;
  /** Mobile apps in the repository, with screens when they use file-based routing. Static. */
  mobile?(root: string): Promise<BookMobileApp[]>;
  /**
   * Mails, jobs, events and notifications by the names code uses. May read a
   * registry that needs the app booted: the builder caches it with the routes
   * (same staleness rule, plus any change to a `mail`, `job`, `event` or
   * `notification` file).
   */
  named?(root: string): Promise<BookNamedThing[]>;
  /** Test files to scan for `@proves` lines. Static. */
  tests?(root: string): Promise<string[]>;
  /** The framework brand and the app's own name and version, for the view's header and footer. Optional; never boots the app. */
  host?(root: string): Promise<BookHost | null> | BookHost | null;
};
