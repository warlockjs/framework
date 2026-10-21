import { afterEach, describe, expect, it } from "vitest";
import type { HydrationDocumentPayloadSource } from "../hydration-payload";
import { publishNamedApiRoutes, readNamedApiRoutes } from "../routing/named-api-routes";
import { installPayloadApiRoutes } from "./install-payload-api-routes";

function payloadWith(document?: Record<string, unknown>): HydrationDocumentPayloadSource {
  return {
    name: "orders.show",
    locale: "en",
    translations: {},
    appData: {},
    layoutData: {},
    pageData: {},
    shared: {},
    ...(document === undefined ? {} : { document: document as never }),
  } as HydrationDocumentPayloadSource;
}

afterEach(() => {
  publishNamedApiRoutes(undefined);
});

describe("installPayloadApiRoutes", () => {
  it("publishes the route table of the page the payload carries", () => {
    installPayloadApiRoutes(
      payloadWith({ namedApiRoutes: { "orders.show": { path: "/orders/:id", method: "GET" } } }),
    );

    expect(readNamedApiRoutes()).toEqual({
      "orders.show": { path: "/orders/:id", method: "GET" },
    });
  });

  it("replaces the previous page's table on a navigation", () => {
    installPayloadApiRoutes(
      payloadWith({ namedApiRoutes: { "orders.show": { path: "/orders/:id", method: "GET" } } }),
    );
    installPayloadApiRoutes(
      payloadWith({ namedApiRoutes: { "users.me": { path: "/me", method: "GET" } } }),
    );

    expect(readNamedApiRoutes()).toEqual({ "users.me": { path: "/me", method: "GET" } });
  });

  it("keeps the current table when the payload carries none", () => {
    publishNamedApiRoutes({ "users.me": { path: "/me", method: "GET" } });

    installPayloadApiRoutes(payloadWith());

    expect(readNamedApiRoutes()).toEqual({ "users.me": { path: "/me", method: "GET" } });
  });
});
