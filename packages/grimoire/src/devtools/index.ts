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
 * open the snapshot with `routes: "cached"` and never boot the app.
 */
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import * as data from "./data";
import { createSnapshotSource } from "./snapshot-source";

export { exportGrimoireSite } from "./site";
export type { ExportGrimoireSiteOptions } from "./site";

/** The parts of devtools' `DevtoolsPanelRequest` the routes read. */
export type GrimoirePanelRequest = {
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string | readonly string[]>>;
  body: unknown;
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
};

/** What the panel factory takes: devtools passes `{ root }`; the rest is for tests and custom setups. */
export type GrimoirePanelContext = {
  /** The app root. */
  root: string;
  /** The adapter to open the book with. Default: the Warlock adapter, loaded on first request. */
  adapter?: BookAdapter | (() => Promise<BookAdapter>);
  /** How long an opened snapshot is reused when the book manifest did not change (ms). Default 2000. */
  ttlMs?: number;
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
  const source = createSnapshotSource(context.root, {
    ...(context.adapter === undefined ? {} : { adapter: context.adapter }),
    ...(context.ttlMs === undefined ? {} : { ttlMs: context.ttlMs }),
  });
  const answer =
    <Answer>(read: (snapshot: GrimoireSnapshot, request: GrimoirePanelRequest) => Answer) =>
    async (request: GrimoirePanelRequest): Promise<Answer> =>
      read(await source.get(), request);

  return {
    id: "grimoire",
    title: "Grimoire",
    view: new URL("../../ui/grimoire-view.js", import.meta.url),
    assets: { "grimoire.css": new URL("../../ui/grimoire.css", import.meta.url) },
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
      {
        path: "/features/:feature",
        handler: answer((snapshot, { params }) => data.feature(snapshot, params.feature)),
      },
      {
        path: "/flows/:feature/:flow",
        handler: answer((snapshot, { params }) => data.flow(snapshot, params.feature, params.flow)),
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
      { path: "/check", handler: answer((snapshot) => data.check(snapshot)) },
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
