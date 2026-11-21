import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared", () => ({
  enterSharedScope: vi.fn(),
  sealShared: vi.fn(async () => Object.freeze({})),
}));

import { connectPageContext, type PageRouteEntry } from "./execute-page-request";
import { renderPageRequest, type RenderedPage } from "./render-page";
import { createCoreHttp } from "./__fixtures__/core-http";

beforeEach(() => {
  connectPageContext({
    buildStore: (payload) => payload as never,
    getStore: () => undefined,
    run: async (_store, callback) => callback(),
  });
});

describe("a page middleware that returns the redirected core Response", () => {
  it.each([{ deferSent: false }, { deferSent: true }])(
    "never serialises the Response (deferSent: $deferSent)",
    async ({ deferSent }) => {
      const http = createCoreHttp({ url: "/staff", deferSent });
      const entry: PageRouteEntry = {
        path: "/staff",
        name: "staff",
        triple: {
          app: {},
          layout: {},
          page: {
            route: { path: "/staff" },
            middleware: [
              (({ response }: { response: typeof http.response }) =>
                response.redirect("/login")) as never,
            ],
            default: () => null,
          },
        },
      };

      const rendered = await renderPageRequest("/staff", {
        routes: [entry],
        createHttp: () => ({ request: http.request, response: http.response }),
      });

      expect(http.reply.redirects).toEqual([{ url: "/login", statusCode: 302 }]);
      const circuit = (rendered as RenderedPage).bundle?.shortCircuit;

      expect(circuit?.stage === "middleware" && circuit.responseSent).toBe(true);
    },
  );
});
