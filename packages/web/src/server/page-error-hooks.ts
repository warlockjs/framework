/**
 * Runtime registration for the server error-report hook.
 *
 * `web.errors.report` in `src/config/web.ts` is one way to receive a server
 * error. Importing an application service from a config file drags that
 * service's whole module graph into config loading, so this is the other way:
 * a module registers its hook from its own `main.ts`, after config has loaded.
 *
 * This file imports nothing, because it is re-exported from the light
 * `@warlock.js/web/connector` barrel (which a `warlock.config.ts` may import).
 * The hook list sits on a registry symbol: in development the connector and the
 * page pipeline run in two module copies, and both must see the same list.
 */

/** What kind of server-side failure produced the report. */
export type PageErrorKind = "render" | "loader" | "defer" | "error-page" | "request-handler";

/** What a {@link PageErrorHook} receives alongside the error. Never carries the query string. */
export type PageErrorInfo = {
  kind: PageErrorKind;
  /** The pipeline stage the failure happened in (`"loader"`, `"render"`, `"stream"`, ...). */
  phase: string;
  level?: string;
  file?: string;
  site?: string;
  routeName?: string;
  /** The matched route's template path (e.g. `/posts/:slug`), never the resolved URL. */
  routePath?: string;
  /** The decoded request path, without the query string. */
  pathname: string;
  method: string;
  statusCode?: number;
  requestId?: string;
};

/**
 * An app-owned hook for a server-side page failure. Called fire-and-forget
 * through the same bounded queue as `web.errors.report`; a throw or rejection is
 * logged once and never re-reported. It never delays a response.
 */
export type PageErrorHook = (error: unknown, info: PageErrorInfo) => void | Promise<void>;

const HOOKS = Symbol.for("warlock.web.pageErrorHooks");

type HookHolder = { [HOOKS]?: Set<PageErrorHook> };

function hooks(): Set<PageErrorHook> {
  const holder = globalThis as HookHolder;

  holder[HOOKS] ??= new Set();

  return holder[HOOKS];
}

/**
 * Register a server error-report hook at runtime, from a module's `main.ts`.
 * Runs in addition to `web.errors.report`. Returns a function that removes it.
 *
 * @example
 * // src/app/monitoring/main.ts
 * import { onPageError } from "@warlock.js/web/connector";
 *
 * onPageError(async (error, info) => {
 *   const { reportToTracker } = await import("./services/tracker.service");
 *   await reportToTracker(error, info);
 * });
 */
export function onPageError(hook: PageErrorHook): () => void {
  hooks().add(hook);

  return () => {
    hooks().delete(hook);
  };
}

/** @internal The registered hooks, in registration order. */
export function registeredPageErrorHooks(): readonly PageErrorHook[] {
  return [...hooks()];
}

/** @internal Test-only: drop every registered hook. */
export function clearPageErrorHooksForTests(): void {
  hooks().clear();
}
