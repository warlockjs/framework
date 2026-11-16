import { config, type Request, type Response } from "@warlock.js/core";

/** A URL that can sit inside a `Link` header's angle brackets without breaking out of it. */
function isSafeLinkTarget(url: string): boolean {
  // Control characters are the point of the check: they can split a header.
  // eslint-disable-next-line no-control-regex
  return url.length > 0 && !/[\s<>"\\\u0000-\u001f]/.test(url);
}

function isCrossOrigin(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);
}

/**
 * The `Link` header values for the assets a page document always needs: the
 * hydration entry and its static chunks as module preloads, the stylesheets as
 * style preloads. A URL that is not safe inside a header is left out.
 */
export function earlyHintLinks(assets: {
  hydrationClientModuleUrl?: string;
  hydrationClientModulePreloadUrls?: readonly string[];
  stylesheetUrls?: readonly string[];
}): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  const add = (url: string | undefined, attributes: string): void => {
    if (url === undefined || seen.has(url) || !isSafeLinkTarget(url)) return;

    seen.add(url);
    // A module script is fetched with CORS, so a cross-origin preload must be
    // too or the browser fetches the file twice.
    links.push(`<${url}>; ${attributes}${isCrossOrigin(url) ? "; crossorigin" : ""}`);
  };

  add(assets.hydrationClientModuleUrl, "rel=modulepreload");

  for (const url of assets.hydrationClientModulePreloadUrls ?? []) {
    add(url, "rel=modulepreload");
  }

  for (const url of assets.stylesheetUrls ?? []) {
    add(url, "rel=preload; as=style");
  }

  return links;
}

type EarlyHintsResponse = {
  headersSent?: boolean;
  writeEarlyHints?: (hints: Record<string, string | string[]>) => void;
};

/**
 * Sends a `103 Early Hints` interim response with `links` when the app opted in
 * with `web.earlyHints` and the connection can carry one. Never throws and
 * never changes the final response: a runtime, proxy or client without support
 * ignores it.
 */
export function sendEarlyHints(
  request: Request,
  response: Response,
  links: readonly string[],
): boolean {
  if (links.length === 0) return false;
  if ((config.get("web", {}) as { earlyHints?: boolean }).earlyHints !== true) return false;

  try {
    // HTTP/1.0 clients cannot receive an interim response.
    if (request.baseRequest?.raw?.httpVersion === "1.0") return false;

    const raw = response.raw as unknown as EarlyHintsResponse | undefined;

    if (raw === undefined || raw.headersSent === true) return false;
    if (typeof raw.writeEarlyHints !== "function") return false;

    raw.writeEarlyHints({ link: [...links] });

    return true;
  } catch {
    return false;
  }
}
