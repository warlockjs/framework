import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as ast from "../syntax/ast";
import {
  apiRouteReferenceFindings,
  clientHiddenRouteNamesOf,
  collectApiRouteFacts,
  declaresApiRoutesOf,
  type ApiRouteFacts,
} from "./api-route-references";

const hidden: ApiRouteFacts = {
  clientHiddenNames: new Set(["internal.reindex"]),
  declaresApiRoutes: false,
};

function findings(
  source: string,
  facts: ApiRouteFacts = hidden,
  fileName = "src/web/orders/orders.page.tsx",
) {
  return apiRouteReferenceFindings(ast.parseSourceFile(fileName, source), facts).map((finding) => ({
    code: finding.code,
    severity: finding.severity,
  }));
}

describe("clientHiddenRouteNamesOf", () => {
  it("reads the literal name of a route registered with clientVisible: false", () => {
    const source = ast.parseSourceFile(
      "src/app/internal/routes.ts",
      `router.post("/internal/reindex", reindex, { name: "internal.reindex", clientVisible: false });
       router.get("/ping", ping, { name: "ping", clientVisible: true });
       router.get("/pong", pong, { clientVisible: false });`,
    );

    expect(clientHiddenRouteNamesOf(source)).toEqual(["internal.reindex"]);
  });
});

describe("declaresApiRoutesOf", () => {
  it("is true only when the config object declares apiRoutes", () => {
    expect(
      declaresApiRoutesOf(
        ast.parseSourceFile(
          "src/web/orders/orders.setup.ts",
          `export const config = { apiRoutes: ["orders.*"] };`,
        ),
      ),
    ).toBe(true);
    expect(
      declaresApiRoutesOf(
        ast.parseSourceFile(
          "src/web/orders/orders.setup.ts",
          `export const config = { fontPreload: false };`,
        ),
      ),
    ).toBe(false);
  });
});

describe("WL9020 and WL9019 browser route references", () => {
  it("reports a literal reference to a hidden route as an error", () => {
    expect(findings(`apiHref("internal.reindex");`)).toEqual([
      { code: "WL9020", severity: "error" },
    ]);
    expect(findings(`useSubmitForm({ route: "internal.reindex" });`)).toEqual([
      { code: "WL9020", severity: "error" },
    ]);
  });

  it("reports a template whose static prefix covers a hidden route", () => {
    expect(findings("apiHref(`internal.${kind}`);")).toEqual([
      { code: "WL9020", severity: "error" },
    ]);
    expect(findings("apiHref(`orders.${id}`);")).toEqual([]);
  });

  it("reports a name only known at run time, unless a page declares apiRoutes", () => {
    expect(findings("apiHref(name);")).toEqual([{ code: "WL9019", severity: "warning" }]);
    expect(findings("useSubmitForm({ route: name });")).toEqual([
      { code: "WL9019", severity: "warning" },
    ]);
    expect(findings("apiHref(name);", { ...hidden, declaresApiRoutes: true })).toEqual([]);
  });

  it("leaves static, visible and path-based references alone", () => {
    expect(findings(`apiHref("orders.show", { params: { id } });`)).toEqual([]);
    expect(findings(`useSubmitForm({ path: "/api/orders", method: "POST" });`)).toEqual([]);
  });

  it("checks only web modules, not test files or server code", () => {
    expect(
      findings(
        `apiHref("internal.reindex");`,
        hidden,
        "src/app/internal/controllers/a.controller.ts",
      ),
    ).toEqual([]);
    expect(
      findings(`apiHref("internal.reindex");`, hidden, "src/web/orders/orders.spec.tsx"),
    ).toEqual([]);
  });
});

describe("collectApiRouteFacts", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "warlock-api-route-facts-"));
    mkdirSync(path.join(root, "src/app/internal"), { recursive: true });
    mkdirSync(path.join(root, "src/web/orders"), { recursive: true });
    writeFileSync(
      path.join(root, "src/app/internal/routes.ts"),
      `router.post("/internal/reindex", reindex, { name: "internal.reindex", clientVisible: false });`,
    );
    writeFileSync(
      path.join(root, "src/web/orders/orders.setup.ts"),
      `export const config = { apiRoutes: ["orders.*"] };`,
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("collects hidden names and app-wide declarations from the given project files", () => {
    const facts = collectApiRouteFacts(root, [
      "src/app/internal/routes.ts",
      "src/web/orders/orders.setup.ts",
    ]);

    expect([...facts.clientHiddenNames]).toEqual(["internal.reindex"]);
    expect(facts.declaresApiRoutes).toBe(true);
  });
});
