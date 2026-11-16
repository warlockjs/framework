import type { HttpContext } from "@warlock.js/core";

/** The `code` an unmatched API request is answered with. */
export const ROUTE_NOT_FOUND_CODE = "route_not_found";

/**
 * Translation key for the message. An app translates it in its locale files;
 * without one, the built-in text for the request's locale (English otherwise)
 * is used.
 */
export const ROUTE_NOT_FOUND_KEY = "web.errors.routeNotFound";

const BUILT_IN_MESSAGES: Record<string, string> = {
  en: "Route not found",
  ar: "المسار غير موجود",
};

/** The body of an unmatched-route answer; `error` stays the human message. */
export type RouteNotFoundBody = {
  error: string;
  code: typeof ROUTE_NOT_FOUND_CODE;
  path: string;
  method: string;
  requestId?: string;
};

function messageFor(request: HttpContext["request"]): string {
  const translated =
    typeof request.t === "function" ? (request.t(ROUTE_NOT_FOUND_KEY) as unknown) : undefined;

  if (typeof translated === "string" && translated !== "" && translated !== ROUTE_NOT_FOUND_KEY) {
    return translated;
  }

  const language = String(request.locale ?? "en")
    .toLowerCase()
    .split("-")[0]!;

  return BUILT_IN_MESSAGES[language] ?? BUILT_IN_MESSAGES.en!;
}

/** Builds the body from the request: a code, a translated message and the request id. */
export function routeNotFoundBody(request: HttpContext["request"]): RouteNotFoundBody {
  return {
    error: messageFor(request),
    code: ROUTE_NOT_FOUND_CODE,
    path: request.path,
    method: request.method,
    ...(typeof request.id === "string" && request.id !== "" ? { requestId: request.id } : {}),
  };
}

/**
 * The one answer for a request that matched no route and did not ask for a
 * document. Used by the catch-all route and by multi-site dispatch, so every
 * unmatched API request reads the same.
 */
export async function sendRouteNotFound(
  context: Pick<HttpContext, "request" | "response">,
  status = 404,
): Promise<void> {
  await context.response.send(routeNotFoundBody(context.request), status);
}
