/**
 * What a package panel's view module (`panels/<id>/view.js`) receives: the
 * 5.55.0 panel API, unchanged, so existing view modules (the Grimoire tab,
 * the built-in Processes tab) keep working inside the React shell. Its
 * default export is called with this object and returns (or fills `root`
 * with) DOM nodes.
 */
export type LegacyPanelContext = {
  id: string;
  /** The element the view renders into. */
  root: HTMLElement;
  /** The panel's part of the location hash. */
  route: string;
  /** Calls the panel's data routes: `api("search?q=x")` → `api/<id>/search?q=x`. Sends the CSRF token on writes. */
  api: (path?: string, init?: RequestInit) => Promise<unknown>;
  /** Absolute URL of one of the panel's assets: `asset("graph.js")` → `<dashboard>/panels/<id>/graph.js`; works with `import()`. */
  asset: (name: string) => string;
  /** Absolute URL of an image in the panel's `files` folder: `file("a/b.png")` → `<dashboard>/panels/<id>/files/a/b.png`. */
  file: (path: string) => string;
  /** `true` when the view runs behind a read-only share link: show the shared (non-technical) view. */
  shared: boolean;
  /**
   * Set for an admin in the production monitor when sharing is on and the
   * panel declares a shared view; `manageHref` opens the link manager for it.
   */
  share: { enabled: boolean; manageHref: string } | null;
  /** Hash link to a view of this panel: `#<id>/<route>`. */
  href: (route?: string) => string;
  navigate: (route?: string) => void;
  /** Renders the panel again. */
  refresh: () => void;
  el: (tag: string, attrs?: Record<string, unknown>, children?: unknown) => HTMLElement;
  svg: (tag: string, attrs?: Record<string, unknown>, children?: unknown) => SVGElement;
  empty: (message: string) => HTMLElement;
};

/** A package panel view module. */
export type LegacyPanelModule = {
  default?: (context: LegacyPanelContext) => unknown;
};
