/**
 * `@warlock.js/grimoire/devtools`: the Grimoire tab of the devtools
 * dashboard. An app enables it in `src/config/devtools.ts`:
 *
 * ```ts
 * panels: ["@warlock.js/grimoire/devtools"]
 * ```
 *
 * The default export is a panel factory (devtools' `DevtoolsPanelExport`),
 * typed structurally here so this entry needs no `@warlock.js/devtools`
 * import. The browser view lives in the package's `ui/` folder. Data routes
 * open the snapshot with `routes: "cached"` (never booting the app) and keep
 * the generated book up to date; agent-written files are only read.
 */
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import path from "node:path";
import type { GrimoireCheckFilter } from "./answers";
import * as data from "./data";
import { productFeature, productFlow, productMap, type ProductErrorSummary } from "./product-map";
import { createSnapshotSource } from "./snapshot-source";

export { buildProductSiteData, exportGrimoireSite, exportGrimoireSiteDetailed } from "./site";
export type { ExportGrimoireSiteOptions, GrimoireSiteExport } from "./site";

/** The parts of devtools' `DevtoolsPanelRequest` the routes read. */
export type GrimoirePanelRequest = {
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string | readonly string[]>>;
  body: unknown;
  /** `true` when the request came through a read-only share link. */
  shared?: boolean;
};

/** Devtools' `DevtoolsPanelShare`, structurally: what a share link may show. */
export type GrimoireDevtoolsPanelShare = {
  view: string | URL;
  routes: readonly string[];
  assets?: readonly string[];
  files?: boolean;
};

/** Devtools' `DevtoolsPanel`, structurally. */
export type GrimoireDevtoolsPanel = {
  id: string;
  title: string;
  view: string | URL;
  routes?: readonly {
    method?: "GET" | "POST";
    path: string;
    handler: (request: GrimoirePanelRequest) => unknown;
  }[];
  assets?: Readonly<Record<string, string | URL>>;
  /** A folder of images served next to the panel. */
  files?: { dir: string; extensions?: readonly string[] };
  /** What a read-only share link may show. */
  share?: GrimoireDevtoolsPanelShare;
  /** Safe for the production monitor: the tab only reads (see `GrimoirePanelContext.mode`). */
  production?: boolean;
};

/** What the panel factory takes: devtools passes `{ root, mode }`; the rest is for tests and custom setups. */
export type GrimoirePanelContext = {
  /** The app root. */
  root: string;
  /**
   * Where the dashboard runs. In `"production"` the tab writes no files:
   * it reads the book as it is on disk. Default: development.
   */
  mode?: "development" | "production";
  /** The adapter to open the book with. Default: the Warlock adapter, loaded on first request. */
  adapter?: BookAdapter | (() => Promise<BookAdapter>);
  /**
   * How long an opened snapshot is reused when the book did not change (ms).
   * Default in development: 2000, longer after a slow open; the old snapshot is served while a
   * background open refreshes it. Default in production: until the book changes.
   */
  ttlMs?: number;
  /**
   * Where the test results are read from (project-relative or absolute).
   * Default `grimoire/book/test-results.json`. Set it when the deploy ships
   * the results from CI; the Vitest reporter writes there with
   * `grimoireReporter({ file })`.
   */
  testResultsFile?: string;
  /** Captured error groups of the monitor (counts only), for the product map's health. Devtools passes it. */
  errors?: () => Promise<readonly ProductErrorSummary[]>;
};

/** The first value of a query parameter. */
function one(query: GrimoirePanelRequest["query"], name: string): string | undefined {
  const value = query[name];

  return Array.isArray(value) ? value[0] : (value as string | undefined);
}

/** Build the panel for the app at `root`. */
export async function grimoireDevtoolsPanel(
  context: GrimoirePanelContext,
): Promise<GrimoireDevtoolsPanel> {
  // In development the tab keeps Warlock's generated files (book, book maps, indexes) up to date, so
  // the next open is incremental. In production it writes nothing. Agent-written files are only read,
  // and cached routes never boot the app.
  const source = createSnapshotSource(context.root, {
    write: context.mode !== "production",
    mode: context.mode ?? "development",
    // The panel runs inside the app's own process. Collecting route facts there boots every connector and
    // re-imports the route and event modules, which would register them twice in the live app. So the tab
    // reads the cached facts and says "missing" or "stale" until `warlock grimoire build` runs elsewhere.
    ...(context.adapter === undefined ? {} : { adapter: context.adapter }),
    ...(context.ttlMs === undefined ? {} : { ttlMs: context.ttlMs }),
    ...(context.testResultsFile === undefined ? {} : { testResultsFile: context.testResultsFile }),
  });

  // In production, start opening the book now so the first tab view is fast.
  if (context.mode === "production") source.warm();

  const answer =
    <Answer>(read: (snapshot: GrimoireSnapshot, request: GrimoirePanelRequest) => Answer) =>
    async (request: GrimoirePanelRequest): Promise<Answer> =>
      read(await source.get(), request);

  /** The product map answers: the shared flag from the request, the errors fetched per request. */
  const product =
    <Answer>(
      read: (
        snapshot: GrimoireSnapshot,
        request: GrimoirePanelRequest,
        options: { shared: boolean; errors: readonly ProductErrorSummary[] | null },
      ) => Answer,
    ) =>
    async (request: GrimoirePanelRequest): Promise<Answer> => {
      const snapshot = await source.get();
      let errors: readonly ProductErrorSummary[] | null = null;

      try {
        errors = (await context.errors?.()) ?? null;
      } catch {
        errors = null;
      }

      return read(snapshot, request, { shared: request.shared === true, errors });
    };

  const number = (value: string | undefined): number | undefined => {
    if (value === undefined || value === "") return undefined;

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const checkFilter = (query: GrimoirePanelRequest["query"]): GrimoireCheckFilter | null => {
    const filter: GrimoireCheckFilter = {};
    const code = one(query, "code");
    const feature = one(query, "feature");
    const flow = one(query, "flow");
    const severity = one(query, "severity");
    const state = one(query, "state");
    const offset = number(one(query, "offset"));
    const limit = number(one(query, "limit"));
    let any = false;

    if (code) {
      filter.code = code;
      any = true;
    }
    if (feature) {
      filter.feature = feature;
      any = true;
    }
    if (flow) {
      filter.flow = flow;
      any = true;
    }
    if (severity === "error" || severity === "warning") {
      filter.severity = severity;
      any = true;
    }
    if (state === "expected" || state === "unexpected") {
      filter.state = state;
      any = true;
    }
    if (offset !== undefined) {
      filter.offset = offset;
      any = true;
    }
    if (limit !== undefined) {
      filter.limit = limit;
      any = true;
    }

    return any ? filter : null;
  };

  return {
    id: "grimoire",
    title: "Grimoire",
    production: true,
    view: new URL("../../ui/grimoire-view.js", import.meta.url),
    assets: {
      "grimoire.css": new URL("../../ui/grimoire.css", import.meta.url),
      "product-map.js": new URL("../../ui/product-map.js", import.meta.url),
      "product-map.css": new URL("../../ui/product-map.css", import.meta.url),
    },
    files: { dir: path.join(context.root, "grimoire", "screenshots") },
    share: {
      view: new URL("../../ui/product-map.js", import.meta.url),
      routes: ["/product", "/product/features/:feature", "/product/flows/:feature/:flow"],
      assets: ["product-map.css"],
      files: true,
    },
    routes: [
      { path: "/summary", handler: answer((snapshot) => data.summary(snapshot)) },
      {
        path: "/search",
        handler: answer((snapshot, { query }) => {
          const limit = Number(one(query, "limit"));

          return data.search(
            snapshot,
            one(query, "q") ?? "",
            Number.isFinite(limit) && limit > 0 ? limit : undefined,
          );
        }),
      },
      {
        path: "/file",
        handler: answer((snapshot, { query }) => data.file(snapshot, one(query, "path"))),
      },
      {
        path: "/impact",
        handler: answer((snapshot, { query }) => data.impact(snapshot, one(query, "path"))),
      },
      {
        path: "/route",
        handler: answer((snapshot, { query }) =>
          data.route(snapshot, one(query, "method"), one(query, "path")),
        ),
      },
      { path: "/features", handler: answer((snapshot) => data.features(snapshot)) },
      {
        path: "/features/:feature",
        handler: answer((snapshot, { params }) => data.feature(snapshot, params.feature)),
      },
      {
        path: "/flows/:feature/:flow",
        handler: answer((snapshot, { params }) =>
          data.flowAnswer(snapshot, params.feature, params.flow),
        ),
      },
      {
        path: "/flows/:feature/:flow/steps/:index/files",
        handler: answer((snapshot, { params, query }) =>
          data.stepFiles(snapshot, params.feature, params.flow, params.index, {
            set: one(query, "set"),
            offset: one(query, "offset"),
            limit: one(query, "limit"),
          }),
        ),
      },
      {
        path: "/product",
        handler: product((snapshot, _request, options) => productMap(snapshot, options)),
      },
      {
        path: "/product/features/:feature",
        handler: product((snapshot, { params }, options) =>
          productFeature(snapshot, params.feature, options),
        ),
      },
      {
        path: "/product/flows/:feature/:flow",
        handler: product((snapshot, { params }, options) =>
          productFlow(snapshot, params.feature, params.flow, options),
        ),
      },
      { path: "/apps", handler: answer((snapshot) => data.apps(snapshot)) },
      {
        path: "/apps/:app/pages/:page",
        handler: answer((snapshot, { params }) => data.page(snapshot, params.app, params.page)),
      },
      { path: "/tasks", handler: answer((snapshot) => data.tasks(snapshot)) },
      { path: "/releases", handler: answer((snapshot) => data.releases(snapshot)) },
      {
        path: "/releases/:release",
        handler: answer((snapshot, { params }) => data.release(snapshot, params.release)),
      },
      {
        path: "/check",
        handler: answer((snapshot, { query }) => {
          const filter = checkFilter(query);

          return filter === null ? data.check(snapshot) : data.checkPage(snapshot, filter);
        }),
      },
      { path: "/check/groups", handler: answer((snapshot) => data.checkGroups(snapshot)) },
      {
        path: "/graph/file",
        handler: answer((snapshot, { query }) => data.graphOfFile(snapshot, one(query, "path"))),
      },
      {
        path: "/graph/feature/:feature",
        handler: answer((snapshot, { params }) => data.graphOfFeature(snapshot, params.feature)),
      },
      {
        path: "/graph/page",
        handler: answer((snapshot, { query }) =>
          data.graphOfPage(snapshot, one(query, "app"), one(query, "page")),
        ),
      },
      { path: "/graph/modules", handler: answer((snapshot) => data.graphOfModules(snapshot)) },
    ],
  };
}

export default grimoireDevtoolsPanel;
