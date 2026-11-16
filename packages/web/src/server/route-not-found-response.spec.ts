import type { HttpContext } from "@warlock.js/core";
import { describe, expect, it, vi } from "vitest";
import { routeNotFoundBody, sendRouteNotFound } from "./route-not-found-response";

function requestOf(options: {
  locale?: string;
  id?: string;
  translations?: Record<string, string>;
}) {
  return {
    method: "GET",
    path: "/api/uzers",
    locale: options.locale,
    id: options.id,
    t: (key: string) => options.translations?.[key] ?? key,
  } as unknown as HttpContext["request"];
}

describe("routeNotFoundBody", () => {
  it("carries a code, the request id and the English message by default", () => {
    expect(routeNotFoundBody(requestOf({ id: "req-1" }))).toEqual({
      error: "Route not found",
      code: "route_not_found",
      path: "/api/uzers",
      method: "GET",
      requestId: "req-1",
    });
  });

  it("uses the built-in text of the request locale", () => {
    expect(routeNotFoundBody(requestOf({ locale: "ar" })).error).toBe("المسار غير موجود");
    expect(routeNotFoundBody(requestOf({ locale: "fr" })).error).toBe("Route not found");
  });

  it("prefers the application's translation of web.errors.routeNotFound", () => {
    const request = requestOf({
      locale: "fr",
      translations: { "web.errors.routeNotFound": "Route introuvable" },
    });

    expect(routeNotFoundBody(request).error).toBe("Route introuvable");
  });
});

describe("sendRouteNotFound", () => {
  it("sends the body with the given status", async () => {
    const send = vi.fn();

    await sendRouteNotFound({ request: requestOf({ id: "r" }), response: { send } as never }, 403);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ code: "route_not_found" }), 403);
  });
});
