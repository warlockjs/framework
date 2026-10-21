import { describe, expect, it } from "vitest";
import { translationPreloadLinks } from "./translation-preload";

describe("translationPreloadLinks", () => {
  it("preloads the shared table with the same-origin fetch the client makes", () => {
    const [link] = translationPreloadLinks({
      url: "/assets/translations/en.0123456789abcdef.json",
      hash: "0123456789abcdef",
      groups: ["app"],
    });

    expect(link?.props).toMatchObject({
      rel: "preload",
      as: "fetch",
      href: "/assets/translations/en.0123456789abcdef.json",
      crossOrigin: "anonymous",
    });
  });

  it("renders nothing for a payload without a shared-table reference", () => {
    expect(translationPreloadLinks(undefined)).toEqual([]);
  });
});
