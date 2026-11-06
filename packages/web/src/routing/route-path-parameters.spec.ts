import { describe, expect, it } from "vitest";
import { parseRoutePathParameters } from "./route-path-parameters";

describe("parseRoutePathParameters", () => {
  it("recognizes required, optional, and wildcard whole-segment parameters", () => {
    expect(parseRoutePathParameters("/posts/:id/:slug?/*")).toEqual({
      type: "precise",
      parameters: [
        { name: "id", optional: false },
        { name: "slug", optional: true },
        { name: "*", optional: false },
      ],
    });
  });

  it("uses broad parameters for syntax it cannot represent safely", () => {
    expect(parseRoutePathParameters("/posts/:id(\\d+)")).toEqual({ type: "broad" });
    expect(parseRoutePathParameters("/files/*/details")).toEqual({ type: "broad" });
  });
});

describe("parseRoutePathParameters — page shapes", () => {
  it("stays broad for mixed segments and a named wildcard unless asked for the page shapes", () => {
    expect(parseRoutePathParameters("/near/:lat-:lng")).toEqual({ type: "broad" });
    expect(parseRoutePathParameters("/files/*rest")).toEqual({ type: "broad" });
  });

  it("names the params of mixed segments and a named wildcard when asked", () => {
    expect(
      parseRoutePathParameters("/:type-for-:purpose/files/*rest", { mixedSegments: true }),
    ).toEqual({
      type: "precise",
      parameters: [
        { name: "type", optional: false },
        { name: "purpose", optional: false },
        { name: "rest", optional: false },
      ],
    });
  });

  it("goes broad for a repeated name, a non-terminal named wildcard or an unsupported segment", () => {
    const options = { mixedSegments: true };

    expect(parseRoutePathParameters("/:a-:a", options)).toEqual({ type: "broad" });
    expect(parseRoutePathParameters("/*rest/x", options)).toEqual({ type: "broad" });
    expect(parseRoutePathParameters("/:a(\\d+)-:b", options)).toEqual({ type: "broad" });
    expect(parseRoutePathParameters("/:a:b", options)).toEqual({ type: "broad" });
  });
});
