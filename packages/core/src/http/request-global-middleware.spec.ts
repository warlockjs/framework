/**
 * `http.middleware.all` / `only` / `except` must be applied (finding B3).
 */
import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "./request";

const ipFilter = async () => undefined;
const routeOnly = async () => undefined;
const skipped = async () => undefined;

function collect(route: any) {
  const request = new Request();
  request.route = route;
  return (request as any).collectMiddlewares();
}

describe("global http middleware", () => {
  afterEach(() => config.set("http.middleware", undefined));

  it("applies http.middleware.all before route middleware", () => {
    config.set("http.middleware", { all: [ipFilter] });

    expect(collect({ path: "/x", middleware: [routeOnly] })).toEqual([ipFilter, routeOnly]);
    expect(collect({ path: "/x" })).toEqual([ipFilter]);
  });

  it("dedupes by reference", () => {
    config.set("http.middleware", { all: [ipFilter] });

    expect(collect({ path: "/x", middleware: [ipFilter] })).toEqual([ipFilter]);
  });

  it("applies only to matching routes", () => {
    config.set("http.middleware", { only: { routes: ["/admin"], middleware: [routeOnly] } });

    expect(collect({ path: "/admin" })).toEqual([routeOnly]);
    expect(collect({ path: "/other" })).toEqual([]);
  });

  it("excludes from matching routes", () => {
    config.set("http.middleware", {
      all: [ipFilter, skipped],
      except: { namedRoutes: ["health"], middleware: [skipped] },
    });

    expect(collect({ path: "/h", name: "health" })).toEqual([ipFilter]);
    expect(collect({ path: "/y", name: "other" })).toEqual([ipFilter, skipped]);
  });
});
