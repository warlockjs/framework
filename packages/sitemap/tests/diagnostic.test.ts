import { describe, expect, it } from "vitest";
import { describeUnresolvedDynamicRoutes } from "../src/diagnostic";

describe("describeUnresolvedDynamicRoutes", () => {
  it("returns undefined when there is nothing to report", () => {
    expect(describeUnresolvedDynamicRoutes([])).toBeUndefined();
  });

  it("names every unresolved dynamic route", () => {
    const message = describeUnresolvedDynamicRoutes(["post-details", "product-details"]);

    expect(message).toContain("post-details");
    expect(message).toContain("product-details");
  });

  it("says OMITTED and mentions the sitemap export", () => {
    const message = describeUnresolvedDynamicRoutes(["post-details"]);

    expect(message).toContain("OMITTED");
    expect(message).toContain("sitemap");
  });
});
