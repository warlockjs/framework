import config from "@mongez/config";
import { rtrim } from "@mongez/reinforcements";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "./request";

type Internals = {
  collectMiddlewares(): unknown[];
  parseBody(data: unknown): Record<string, unknown>;
};

const internals = (request: Request) => request as unknown as Internals;

const appWide = () => undefined;
const routeOwn = () => undefined;
const extra = () => undefined;

afterEach(() => {
  config.set("http", undefined);
});

describe("collectMiddlewares", () => {
  it("resolves the list once per route and config", () => {
    config.set("http", { middleware: { all: [appWide] } });

    const route = { path: "/orders", middleware: [routeOwn] };
    const first = new Request();
    const second = new Request();
    first.route = route as never;
    second.route = route as never;

    const list = internals(first).collectMiddlewares();

    expect(list).toEqual([appWide, routeOwn]);
    expect(internals(second).collectMiddlewares()).toBe(list);
  });

  it("rebuilds when the config is replaced or a list grows", () => {
    config.set("http", { middleware: { all: [appWide] } });

    const route = { path: "/orders", middleware: [routeOwn] };
    const request = new Request();
    request.route = route as never;

    const before = internals(request).collectMiddlewares();

    route.middleware.push(extra);
    expect(internals(request).collectMiddlewares()).toEqual([appWide, routeOwn, extra]);

    config.set("http", {
      middleware: { all: [appWide], except: { routes: ["/orders"], middleware: [appWide] } },
    });
    expect(internals(request).collectMiddlewares()).toEqual([routeOwn, extra]);
    expect(before).toEqual([appWide, routeOwn]);
  });
});

describe("parseBody keys", () => {
  it("strips a trailing array marker exactly as before", () => {
    const request = new Request();
    const parse = (data: Record<string, unknown>) => internals(request).parseBody(data);

    expect(parse({ "tags[]": ["x", "y"] })).toEqual({ tags: ["x", "y"] });
    expect(parse({ "user[name]": "Ada" })).toEqual({ user: { name: "Ada" } });

    // `[` followed by one or more `]` is removed from the end of the key,
    // the rule `rtrim(key, "[]")` applied.
    expect(rtrim("odd[]]", "[]")).toBe("odd");
    expect(parse({ "odd[]]": "v" })).toEqual({ odd: "v" });
    expect(parse({ "list[][]": "v" })).toEqual({ list: { "": ["v"] } });
    expect(parse({ plain: "v" })).toEqual({ plain: "v" });
  });
});
