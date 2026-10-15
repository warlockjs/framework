import { afterEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/router/router";
import {
  matchesDerivedRouteName,
  routeNameMethodSuffix,
} from "../../../src/router/route-name-method-suffix";
import type { RequestHandler } from "../../../src/router/types";

/**
 * The route-name method suffix is assigned at REGISTRATION, from the whole
 * route set. `warlock build` never boots connectors, so the page-route manifest
 * cannot predict it — `matchesDerivedRouteName` is how a derived name is
 * compared against a registered one without loosening anything else.
 *
 * Source: core/src/router/route-name-method-suffix.ts, core/src/router/router.ts
 * (Router.add — cross-method name collision).
 */
const router = Router.getInstance();

const noop: RequestHandler = () => undefined as never;

const SOURCE = "route-name-method-suffix.test.ts";

afterEach(() => {
  router.removeRoutesBySourceFile(SOURCE);
});

describe("routeNameMethodSuffix", () => {
  it("lower-cases the method and prefixes a dot", () => {
    expect(routeNameMethodSuffix("GET")).toBe(".get");
    expect(routeNameMethodSuffix("post")).toBe(".post");
  });

  it("is the suffix the router actually appends on a cross-method collision", async () => {
    await router.withSourceFile(SOURCE, () => {
      router.post("/suffix-probe", noop, { name: "suffix.probe" });
      router.get("/suffix-probe-page", noop, { name: "suffix.probe", isPage: true });
    });

    const names = router
      .list()
      .filter((route) => route.sourceFile === SOURCE)
      .map((route) => route.name);

    expect(names).toContain("suffix.probe");
    // The registered name is the derived one plus this exact suffix — the two
    // halves of the rule share one definition, so they cannot drift.
    expect(names).toContain("suffix.probe" + routeNameMethodSuffix("GET"));
  });
});

describe("matchesDerivedRouteName", () => {
  it("accepts the derived name unchanged", () => {
    expect(matchesDerivedRouteName("api.form", "api.form", "GET")).toBe(true);
  });

  it("accepts the derived name plus the registration collision suffix", () => {
    expect(matchesDerivedRouteName("api.form", "api.form.get", "GET")).toBe(true);
  });

  it("rejects a suffix for a different method than the route was registered under", () => {
    expect(matchesDerivedRouteName("api.form", "api.form.post", "GET")).toBe(false);
  });

  it("rejects any other name difference — it is not a prefix match", () => {
    expect(matchesDerivedRouteName("api.form", "api.form.getter", "GET")).toBe(false);
    expect(matchesDerivedRouteName("api.form", "api.forms", "GET")).toBe(false);
    expect(matchesDerivedRouteName("api.form", "api", "GET")).toBe(false);
    expect(matchesDerivedRouteName("api.form", "", "GET")).toBe(false);
  });

  it("does not strip a suffix the derived name legitimately ends with", () => {
    // A page at `src/web/api/get.page.tsx` derives the name `api.get`. Blindly
    // stripping `.get` from the live side would compare `api` to `api.get` and
    // report drift on an untouched checkout.
    expect(matchesDerivedRouteName("api.get", "api.get", "GET")).toBe(true);
  });
});
