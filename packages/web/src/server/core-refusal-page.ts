/**
 * CORE-LEVEL REFUSALS ON A PAGE HOST.
 *
 * Core refuses some requests before any route runs: a dot-segment or
 * path-traversal path on the public mount (403), a malformed URL (400). Those
 * answer JSON, which is right for an API client and wrong for a browser that
 * navigated to the URL. Core hands such a refusal, when the request is a
 * document request, to the route marked `handlesRefusals` — the page catch-all
 * this package registers — and that route renders it with this module.
 *
 * The page is the one a thrown 4xx from a page route would show: the site's
 * `forbidden.page.tsx` for 401/403, its `error.page.tsx` otherwise, and the
 * framework fallback page when the site ships neither. The status stays the
 * refused status.
 */
import { HttpError, type HttpContext } from "@warlock.js/core";
import type { ErrorPageModuleLoader } from "./error-page";
import { defaultApplyBufferedCookie } from "./create-page-route-handler";
import type { RouteTranslationsResolver } from "./route-translations";
import { readLocaleRouting } from "../routing/locale-routing";
import type { FailureShell } from "./render-page";
import { writePageFailureResponse } from "./page-route-handler/write-page-failure-response";

/** Renders a core-level refusal as the site's page. */
export type RefusalPageRenderer = (context: HttpContext, status: number) => Promise<void>;

export type RefusalPageRendererOptions = {
  /** Route name the refusal page is reported under. */
  name: string;
  appFile?: string;
  errorPageFile?: string;
  loadErrorPage?: ErrorPageModuleLoader;
  getRouteTranslations?: RouteTranslationsResolver;
  /** Read per refusal, so a dev module graph warmed since boot is picked up. */
  stylesheetUrls?: () => readonly string[];
  hydrationClientModuleUrl?: string;
  /**
   * Loads the app root and the layouts the refusal page renders inside, so it
   * keeps the site's header and footer. Without it (or when it fails) the page
   * renders inside the framework's default document.
   */
  loadShell?: () => Promise<FailureShell | undefined>;
};

/**
 * Pins `request.locale` to the locale the URL prefix names, the same way the
 * not-found page does, so `/ar/...` is answered in `ar` and not in the locale
 * core resolved from the query, cookies or headers.
 */
function pinPathLocale(request: HttpContext["request"]): void {
  const routing = readLocaleRouting();

  if (routing.strategy === "none") return;

  const leadingSegment = request.path.split("?")[0]?.split("/")[1];

  if (leadingSegment !== undefined && routing.codes.includes(leadingSegment)) {
    request.locale = leadingSegment;
  }
}

const REFUSAL_MESSAGES: Record<number, string> = {
  400: "Bad request.",
  401: "Authentication is required.",
  403: "Forbidden.",
  405: "Method not allowed.",
  414: "The request URL is too long.",
};

/** Builds the renderer both page installers hand to the not-found catch-all. */
export function createRefusalPageRenderer(
  options: RefusalPageRendererOptions,
): RefusalPageRenderer {
  return async ({ request, response }, status) => {
    const thrown = new HttpError(status, REFUSAL_MESSAGES[status] ?? "The request was refused.");

    response.header("Cache-Control", "no-store");
    pinPathLocale(request);

    await writePageFailureResponse({
      name: options.name,
      request,
      response,
      thrown,
      loadErrorPage: options.loadErrorPage,
      routeTranslations: options.getRouteTranslations?.(
        options.errorPageFile ?? options.appFile ?? "",
        request.locale,
      ),
      getRouteTranslations: options.getRouteTranslations,
      appFile: options.appFile,
      errorPageFile: options.errorPageFile,
      stylesheetUrls: options.stylesheetUrls?.(),
      hydrationClientModuleUrl: options.hydrationClientModuleUrl,
      loadShell: options.loadShell,
      wantsData: false,
      status,
      applyBufferedCookie: defaultApplyBufferedCookie,
    });
  };
}
