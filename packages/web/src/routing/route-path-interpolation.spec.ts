import { describe, expect, it } from "vitest";
import { href, publishRouteTable, resetRouteTable } from "./route-table";
import { interpolateRoutePath } from "./route-path-interpolation";

function interpolateFormPath(path: string, params: Record<string, unknown>): string {
  return interpolateRoutePath(path, params, {
    isMissing: (value) => value === undefined || value === null,
    onMissingParameter: (name) => {
      throw new Error(
        `Submit route ${JSON.stringify(path)} is missing path parameter ${JSON.stringify(name)}.`,
      );
    },
  });
}

describe("interpolateRoutePath", () => {
  it("interpolates and encodes required and wildcard parameters for pages and forms alike", () => {
    publishRouteTable([{ name: "files.show", path: "/files/:id/*" }]);

    expect(href("files.show", { id: "a b", "*": "nested/path" })).toBe("/files/a%20b/nested/path");
    expect(interpolateFormPath("/files/:id/*", { id: "a b", "*": "nested/path" })).toBe(
      "/files/a%20b/nested/path",
    );

    resetRouteTable();
  });

  it("omits an optional whole segment cleanly, including from the root", () => {
    expect(interpolateFormPath("/posts/:id?/comments", { id: null })).toBe("/posts/comments");
    expect(interpolateFormPath("/:locale?", { locale: undefined })).toBe("/");
  });

  it("retains href's public missing and unknown parameter errors", () => {
    publishRouteTable([{ name: "posts.show", path: "/posts/:id" }]);

    expect(() => href("posts.show")).toThrow(
      'Warlock href("posts.show") is missing the parameter "id"',
    );
    expect(() => href("posts.show", { typo: "x" })).toThrow(
      'Warlock href("posts.show") was given "typo"',
    );

    resetRouteTable();
  });

  it("uses legacy behavior for grammar the parser cannot safely narrow", () => {
    expect(interpolateFormPath("/posts/:id(\\d+)", { id: 7 })).toBe("/posts/7(\\d+)");
  });
});

describe("interpolateRoutePath — page shapes", () => {
  it("encodes each param of a mixed segment and keeps the static text", () => {
    publishRouteTable([
      { name: "listing", path: "/:type-for-:purpose" },
      { name: "near", path: "/near/:lat-:lng" },
      { name: "image", path: "/img/:name.png" },
    ]);

    expect(href("listing", { type: "flat/2", purpose: "sale" })).toBe("/flat%2F2-for-sale");
    expect(href("near", { lat: "-1.5", lng: "2.5" })).toBe("/near/-1.5-2.5");
    expect(href("image", { name: "a b" })).toBe("/img/a%20b.png");
    expect(() => href("near", { lat: "1" } as never)).toThrow(
      'Warlock href("near") is missing the parameter "lng"',
    );
    expect(() => href("near", { lat: "1", lng: "2", x: "3" } as never)).toThrow('was given "x"');

    resetRouteTable();
  });

  it("fills a named wildcard under its name and keeps its slashes", () => {
    publishRouteTable([{ name: "files", path: "/files/*rest" }]);

    expect(href("files", { rest: "a b/c" })).toBe("/files/a%20b/c");
    expect(() => href("files", { "*": "a" } as never)).toThrow();

    resetRouteTable();
  });

  it("leaves mixed segments to the legacy replacement for form and API targets", () => {
    expect(interpolateFormPath("/near/:lat-:lng", { lat: 1, lng: 2 })).toBe("/near/1-2");
  });
});
