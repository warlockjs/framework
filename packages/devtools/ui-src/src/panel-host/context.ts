import { NOT_FOUND_EVENT, getCsrfToken } from "@/api/client";
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
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

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

    throw new Error(message);
  }

  return response.status === 204 ? undefined : response.json();
}

export type PanelContextOptions = {
  id: string;
  root: HTMLElement;
  route: string;
  /** Renders the panel again. */
  refresh: () => void;
};

/** What a panel's view module receives: the 5.55.0 panel API. */
export function buildPanelContext({ id, root, route, refresh }: PanelContextOptions): LegacyPanelContext {
  return {
    id,
    root,
    route,
    api: (path, init) => panelFetch(panelApiUrl(id, path), init),
    asset: (name) => `panels/${id}/${name}`,
    href: (next) => panelHref(id, next),
    navigate(next) {
      const hash = panelHref(id, next);

      if (location.hash === hash) refresh();
      else location.hash = hash;
    },
    refresh,
    el,
    svg,
    empty,
  };
}
