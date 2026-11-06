import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { matchClientRoute } from "../client/runtime/matcher";
import type { ClientPageEntry } from "../client/runtime/types";
import { routerPathOf, withNamedWildcardParam } from "../routing/mixed-route-segment";
import { matchPath } from "./match-page-route";

/**
 * Do the client matcher and the server fallback matcher choose the same route,
 * and split an ambiguous segment the same way, as the router that serves pages
 * (Fastify, on find-my-way)?
 *
 * Every case runs the REAL router: the routes are registered the way the page
 * installers register them (a named wildcard through `routerPathOf`, its alias
 * added with `withNamedWildcardParam`) and each URL is injected. The same route
 * table is then given to `matchClientRoute`, in every registration order, and
 * each single pattern to `matchPath`. A route table where the router's answer
 * depends on registration order (two mixed segments that match the same URL
 * and tie on leading text, trailing text and total text) is deliberately not
 * pinned here — it is documented as ambiguous.
 */

type Outcome = { route: string; params: Record<string, string> } | null;

async function serverOutcome(routes: readonly string[], url: string): Promise<Outcome> {
  const server = Fastify();
  let outcome: Outcome = null;

  for (const route of routes) {
    server.get(routerPathOf(route), async (request) => {
      outcome = {
        route,
        params: withNamedWildcardParam(route, { ...(request.params as Record<string, string>) }),
      };
      return {};
    });
  }

  await server.inject({ method: "GET", url });
  await server.close();

  return outcome;
}

function clientOutcome(routes: readonly string[], url: string): Outcome {
  const entries: ClientPageEntry[] = routes.map((path, index) => ({
    type: "page",
    name: `route${index}`,
    path,
    load: () => ({ Page: {}, layouts: [] }),
  }));
  const match = matchClientRoute(entries, url);

  return match === null ? null : { route: match.entry.path, params: { ...match.params } };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];

  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

const CASES: Array<[routes: readonly string[], urls: readonly string[]]> = [
  [
    ["/:type-for-:purpose"],
    [
      "/house-for-sale",
      "/a-for-b-for-c",
      "/a-for-",
      "/-for-b",
      "/x",
      "/a-for-b/c",
      "/%D8%B4%D9%82%D8%A9-for-%D8%A8%D9%8A%D8%B9",
    ],
  ],
  [["/near/:lat-:lng"], ["/near/1.5-2.5", "/near/-1.5-2.5", "/near/1-2-3", "/near/1"]],
  [["/:a-:b-:c"], ["/1-2-3", "/1-2-3-4", "/1-2"]],
  [["/:a-x-:b-y-:c"], ["/1-x-2-y-3", "/1-x-2-x-3-y-4-y-5"]],
  [["/pre-:id"], ["/pre-5", "/pre-1-2", "/other-5"]],
  [["/:name.png"], ["/logo.png", "/a.b.png", "/logo.jpg"]],
  [["/:id", "/:type-for-:purpose"], ["/house-for-sale", "/abc"]],
  [["/house-for-sale", "/:type-for-:purpose", "/:id"], ["/house-for-sale", "/flat-for-rent", "/abc"]],
  [["/p-:a", "/:a-for-:b"], ["/p-for-b", "/p-1", "/q-for-z"]],
  [["/x-for-:b", "/:a-for-:b"], ["/x-for-z", "/q-for-z"]],
  [["/:a-for-z", "/:a-for-:b"], ["/x-for-z", "/x-for-q"]],
  [["/:a-for-:b", "/:a"], ["/a-for-b", "/a", "/a-for-b/c"]],
  [["/:a-for-:b", "/*"], ["/a-for-b", "/zz", "/a/b"]],
  [["/a-:x/b", "/:y/c"], ["/a-1/b", "/a-1/c"]],
  [["/p-:a/x", "/:a-for-:b/y"], ["/p-q-for-b/y", "/p-q/x", "/p-q/y"]],
  [["/files/*rest"], ["/files/a", "/files/a/b/c", "/files/a%20b/c"]],
  [["/files/*rest", "/files/:id"], ["/files/a", "/files/a/b"]],
  [["/files/*", "/files/:id"], ["/files/a", "/files/a/b"]],
  [["/blog/:slug-:id", "/blog/*rest"], ["/blog/hello-5", "/blog/hello", "/blog/a/b"]],
];

describe("mixed and named-wildcard page routes pick the router's route with the router's params", () => {
  for (const [routes, urls] of CASES) {
    it(`${routes.join("  ")}`, async () => {
      for (const url of urls) {
        const fromRouter = await serverOutcome(routes, url);

        for (const order of permutations(routes)) {
          const fromRouterInOrder = await serverOutcome(order, url);

          expect(fromRouterInOrder, `router, ${url}, order ${order.join(" ")}`).toEqual(fromRouter);
          expect(clientOutcome(order, url), `client, ${url}, order ${order.join(" ")}`).toEqual(
            fromRouter,
          );
        }
      }
    });
  }

  it("splits a segment the same way in the server fallback matcher", async () => {
    const checks: Array<[pattern: string, url: string]> = [
      ["/:type-for-:purpose", "/house-for-sale"],
      ["/:type-for-:purpose", "/a-for-b-for-c"],
      ["/:type-for-:purpose", "/a-for-"],
      ["/near/:lat-:lng", "/near/-1.5-2.5"],
      ["/near/:lat-:lng", "/near/1-2-3"],
      ["/:a-:b-:c", "/1-2-3-4"],
      ["/:a-x-:b-y-:c", "/1-x-2-x-3-y-4-y-5"],
      ["/pre-:id", "/pre-1-2"],
      ["/:name.png", "/a.b.png"],
      ["/files/*rest", "/files/a/b/c"],
    ];

    for (const [pattern, url] of checks) {
      const fromRouter = await serverOutcome([pattern], url);

      expect(fromRouter, `${pattern} ${url}`).not.toBeNull();
      expect(matchPath(pattern, url), `${pattern} ${url}`).toEqual(fromRouter?.params);
    }
  });

  it("does not match where the router does not", async () => {
    for (const [pattern, url] of [
      ["/:type-for-:purpose", "/x"],
      ["/:type-for-:purpose", "/a-for-b/c"],
      ["/pre-:id", "/other-5"],
    ] as const) {
      expect(await serverOutcome([pattern], url)).toBeNull();
      expect(matchPath(pattern, url)).toBeUndefined();
    }
  });
});
