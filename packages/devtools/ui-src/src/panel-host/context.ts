import { NOT_FOUND_EVENT, getCsrfToken } from "@/api/client";
import { isConnectionFailure, reportFailure, reportSuccess } from "@/api/connection";
import { el, empty, panelApiUrl, panelHref, svg } from "./dom";
import type { LegacyPanelContext } from "./types";

/**
 * Calls a panel's data route with the 5.55.0 behaviour: JSON in and out,
 * `Error(message)` on failure. Writes carry the session's CSRF token.
 */
export async function panelFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const token = getCsrfToken();

  if (method !== "GET" && method !== "HEAD" && token) headers.set("X-Devtools-Csrf", token);

  let response: Response;

  try {
    response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  } catch {
    reportFailure();

    throw Object.assign(
      new Error("Could not reach the server. Check your connection and try again."),
      {
        status: 0,
      },
    );
  }

  if (isConnectionFailure(response.status)) reportFailure();
  else reportSuccess();

  if (!response.ok && response.status !== 204) {
    let message = response.statusText || `Request failed (${response.status})`;
    let coded = false;

    try {
      const body = (await response.json()) as { error?: string; code?: string };

      message = body.error || message;
      coded = body.code !== undefined;
    } catch {
      // The answer has no JSON body.
    }

    if (response.status === 404 && !coded) {
      window.dispatchEvent(new CustomEvent(NOT_FOUND_EVENT, { detail: { path: url } }));
    }

    throw Object.assign(new Error(message), { status: response.status });
  }

  return response.status === 204 ? undefined : response.json();
}

export type PanelContextOptions = {
  id: string;
  root: HTMLElement;
  route: string;
  /** Renders the panel again. */
  refresh: () => void;
  /** Behind a read-only share link: calls, assets and images go through `api/share/*`. */
  shared?: boolean;
  /** The `share` value of the context (see `LegacyPanelContext.share`). */
  share?: LegacyPanelContext["share"];
};

/** A URL path with each segment encoded (a file path inside the panel's folder). */
function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment !== "")
    .map(encodeURIComponent)
    .join("/");
}

/**
 * A dashboard-relative URL made absolute against the page. A bare relative
 * path such as `panels/<id>/x.js` is a module specifier `import()` refuses,
 * so `asset()` and `file()` hand out absolute URLs that work for `import()`,
 * `<link href>` and `<img src>` alike.
 */
export function absoluteUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/** A shared panel's data URL: `""`, `"/product"`, `"product?x=1"` resolve under `api/share/panel`. */
export function sharedApiUrl(path = ""): string {
  const suffix = !path || path.startsWith("?") ? path : path.startsWith("/") ? path : `/${path}`;

  return `api/share/panel${suffix}`;
}

/** What a panel's view module receives: the 5.55.0 panel API. */
export function buildPanelContext({
  id,
  root,
  route,
  refresh,
  shared = false,
  share = null,
}: PanelContextOptions): LegacyPanelContext {
  return {
    id,
    root,
    route,
    api: (path, init) => panelFetch(shared ? sharedApiUrl(path) : panelApiUrl(id, path), init),
    asset: (name) =>
      absoluteUrl(
        shared
          ? `api/share/assets/${encodeURIComponent(name)}`
          : `panels/${id}/${encodeURIComponent(name)}`,
      ),
    file: (path) =>
      absoluteUrl(
        shared ? `api/share/files/${encodePath(path)}` : `panels/${id}/files/${encodePath(path)}`,
      ),
    shared,
    share: shared ? null : share,
    href: (next) => (shared ? `#share${next ? `/${next}` : ""}` : panelHref(id, next)),
    navigate(next) {
      const hash = shared ? `#share${next ? `/${next}` : ""}` : panelHref(id, next);

      if (location.hash === hash) refresh();
      else location.hash = hash;
    },
    refresh,
    el,
    svg,
    empty,
  };
}
