import { beforeEach, describe, expect, it } from "vitest";
import {
  assetsUrl,
  publicUrl,
  setBaseUrl,
  uploadsUrl,
  url,
} from "../../../src/utils/urls";

// NOTE: the base url is held in a module-level variable set via setBaseUrl(),
// not in @mongez/config. The HTTP application wires it during boot.
beforeEach(() => {
  setBaseUrl("https://store.test");
});

describe("url", () => {
  it("joins the base url with a relative path", () => {
    expect(url("products")).toBe("https://store.test/products");
  });

  it("normalizes a leading slash on the path", () => {
    expect(url("/products")).toBe("https://store.test/products");
  });

  it("strips a trailing slash from the base url", () => {
    setBaseUrl("https://store.test/");

    expect(url("products")).toBe("https://store.test/products");
  });

  it("returns the base url with a trailing slash for an empty path", () => {
    expect(url()).toBe("https://store.test/");
  });

  it("works with an empty base url", () => {
    setBaseUrl("");

    expect(url("products")).toBe("/products");
  });
});

describe("uploadsUrl", () => {
  it("prefixes the path with /uploads", () => {
    expect(uploadsUrl("avatars/1.png")).toBe(
      "https://store.test/uploads/avatars/1.png",
    );
  });

  it("normalizes a leading slash on the path", () => {
    expect(uploadsUrl("/avatars/1.png")).toBe(
      "https://store.test/uploads/avatars/1.png",
    );
  });

  it("returns the uploads root for an empty path", () => {
    expect(uploadsUrl()).toBe("https://store.test/uploads/");
  });
});

describe("publicUrl", () => {
  it("prefixes the path with /public", () => {
    expect(publicUrl("robots.txt")).toBe("https://store.test/public/robots.txt");
  });

  it("returns the public root for an empty path", () => {
    expect(publicUrl()).toBe("https://store.test/public/");
  });
});

describe("assetsUrl", () => {
  it("nests assets under the public route", () => {
    expect(assetsUrl("app.css")).toBe(
      "https://store.test/public/assets/app.css",
    );
  });

  it("returns the assets root for an empty path", () => {
    expect(assetsUrl()).toBe("https://store.test/public/assets/");
  });
});
