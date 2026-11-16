/**
 * `@warlock.js/grimoire/devtools` (owned by T-134): the Grimoire tab of the
 * devtools dashboard. An app enables it in `src/config/devtools.ts`:
 *
 * ```ts
 * panels: ["@warlock.js/grimoire/devtools"]
 * ```
 *
 * The default export is a panel factory (devtools' `DevtoolsPanelExport`),
 * typed structurally here so this entry needs no `@warlock.js/devtools`
 * import. The view module lives in the package's `ui/` folder.
 */

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

/** Build the panel for the app at `root`. */
export async function grimoireDevtoolsPanel(context: { root: string }): Promise<GrimoireDevtoolsPanel> {
  void context;
  throw new Error("not implemented");
}

/** Options of `exportGrimoireSite()`. */
export type ExportGrimoireSiteOptions = {
  /** Output folder, project-relative. Default `grimoire/book/site`. */
  outDir?: string;
};

/**
 * Write the tab as static files (an `index.html`, the view module, and one
 * JSON file per data route answer) for people without the app running.
 *
 * @param root Absolute project root.
 * @returns The output folder, project-relative.
 */
export async function exportGrimoireSite(
  root: string,
  options: ExportGrimoireSiteOptions = {},
): Promise<string> {
  void root;
  void options;
  throw new Error("not implemented");
}

export default grimoireDevtoolsPanel;
