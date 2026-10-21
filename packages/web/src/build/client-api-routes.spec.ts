import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appConventionAliases } from "../vite/app-convention-aliases";
import {
  analyzeClientApiRoutes,
  createClientApiRouteResolver,
  resolveApplicationImport,
  resolveClientApiRouteNames,
} from "./client-api-routes";
import { readModuleConfig } from "./read-module-config";

let appRoot: string;
let src: string;

function write(relative: string, source: string): string {
  const file = path.join(appRoot, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}

beforeEach(() => {
  appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-client-api-routes-"));
  src = path.join(appRoot, "src");
});

afterEach(() => {
  fs.rmSync(appRoot, { recursive: true, force: true });
});

/**
 * A page whose client code names routes by literal, by template prefix and
 * through a declaration, plus a server-only loader naming a route the browser
 * never receives.
 */
function orderFixture() {
  const rootFile = write("src/web/root.tsx", "export default function App() { return null; }\n");
  const page = write(
    "src/web/orders/orders.page.tsx",
    [
      'import { apiHref, useSubmitForm } from "@warlock.js/web";',
      'import OrderRow from "web/components/order-row";',
      'import { helper } from "./helper";',
      'export const loader = async () => apiHref("admin.secret");',
      "export default function Page() {",
      '  const href = apiHref("orders.show", { params: { id: 1 } });',
      '  const submit = useSubmitForm({ route: "orders.create" });',
      "  const extra = [helper, OrderRow];",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );
  const setup = write(
    "src/web/orders/orders.setup.ts",
    'export const config = { apiRoutes: ["reports.*", "exports.daily"] };\nexport const loader = async () => null;\nexport function register() {}\n',
  );
  write(
    "src/web/components/order-row.tsx",
    'import { apiHref } from "@warlock.js/web";\nexport default function OrderRow() { return apiHref("orders.list"); }\n',
  );
  write(
    "src/web/orders/helper.ts",
    'export const helper = `orders.${"x"}`;\nexport const other = `reports.${1}`;\n',
  );
  write("src/web/orders/unreached.ts", 'export const hidden = "admin.hidden";\n');

  return {
    modules: [{ file: rootFile }, { file: page, setupFile: setup }],
    aliases: appConventionAliases(src),
  };
}

describe("analyzeClientApiRoutes", () => {
  it("collects names from the client graph, declarations and template prefixes, not server exports or unreached modules", () => {
    const sources = orderFixture();
    const analysis = analyzeClientApiRoutes(sources);

    expect(analysis.literals.has("orders.show")).toBe(true);
    expect(analysis.literals.has("orders.create")).toBe(true);
    expect(analysis.literals.has("orders.list")).toBe(true);
    expect(analysis.literals.has("admin.secret")).toBe(false);
    expect(analysis.literals.has("admin.hidden")).toBe(false);
    expect(analysis.prefixes.has("orders.")).toBe(true);
    expect(analysis.prefixes.has("reports.")).toBe(true);
    expect(analysis.declared).toEqual(["reports.*", "exports.daily"]);
    expect(analysis.files).toContain(path.join(src, "web/components/order-row.tsx"));
    expect(analysis.files).not.toContain(path.join(src, "web/orders/unreached.ts"));
  });
});

describe("resolveClientApiRouteNames", () => {
  it("keeps the registered names the client reaches, by literal, template prefix or declaration", () => {
    const analysis = analyzeClientApiRoutes(orderFixture());

    expect(
      resolveClientApiRouteNames(analysis, [
        "admin.secret",
        "admin.hidden",
        "orders.show",
        "reports.daily",
        "exports.daily",
        "exports.weekly",
        "other.route",
      ]),
    ).toEqual(["exports.daily", "orders.show", "reports.daily"]);
  });

  it("returns nothing for a graph that reaches no name", () => {
    const analysis = {
      literals: new Set<string>(),
      prefixes: new Set<string>(),
      declared: [],
      files: [],
    };

    expect(resolveClientApiRouteNames(analysis, ["orders.show"])).toEqual([]);
  });
});

describe("resolveApplicationImport", () => {
  it("resolves relative and convention-alias imports to application files, and leaves packages alone", () => {
    const sources = orderFixture();
    const importer = path.join(src, "web/orders/orders.page.tsx");

    expect(resolveApplicationImport("./helper", importer, sources.aliases)).toBe(
      path.join(src, "web/orders/helper.ts"),
    );
    expect(resolveApplicationImport("web/components/order-row", importer, sources.aliases)).toBe(
      path.join(src, "web/components/order-row.tsx"),
    );
    expect(resolveApplicationImport("@warlock.js/web", importer, sources.aliases)).toBeUndefined();
    expect(resolveApplicationImport("./missing", importer, sources.aliases)).toBeUndefined();
  });
});

describe("createClientApiRouteResolver", () => {
  it("answers from the current sources and walks again when a file the walk read has changed", () => {
    const sources = orderFixture();
    write(
      "src/web/components/order-row.tsx",
      'import { apiHref } from "@warlock.js/web";\nexport default function OrderRow() { return apiHref("shop.list"); }\n',
    );
    const resolve = createClientApiRouteResolver(sources, () => ["shop.list", "shop.newest"]);

    expect(resolve()).toEqual(["shop.list"]);

    write(
      "src/web/components/order-row.tsx",
      'import { apiHref } from "@warlock.js/web";\nexport default function OrderRow() { return apiHref("shop.newest"); }\n',
    );

    expect(resolve()).toEqual(["shop.newest"]);
  });
});

describe("config.apiRoutes reading", () => {
  it("reads literal names and prefix patterns, unique and in source order", () => {
    const read = readModuleConfig(
      "orders.setup.ts",
      'export const config = { apiRoutes: ["orders.show", "reports.*", "orders.show"] };',
      "page",
      { allowMissingDefault: true },
    );

    expect(read.apiRoutes).toEqual(["orders.show", "reports.*"]);
  });

  it.each([
    ["a non-array value", 'export const config = { apiRoutes: "orders.show" };'],
    ["a computed entry", "export const config = { apiRoutes: [name] };"],
    ["a bare wildcard", 'export const config = { apiRoutes: ["*"] };'],
    ["a name with a space", 'export const config = { apiRoutes: ["orders show"] };'],
  ])("refuses %s", (_label, source) => {
    expect(() =>
      readModuleConfig("orders.setup.ts", source, "page", { allowMissingDefault: true }),
    ).toThrow("config.apiRoutes");
  });

  it("accepts the key on a layout and on the root", () => {
    expect(
      readModuleConfig("layout.tsx", 'export const config = { apiRoutes: ["nav.*"] };', "layout", {
        allowMissingDefault: true,
      }).apiRoutes,
    ).toEqual(["nav.*"]);
    expect(
      readModuleConfig("root.tsx", 'export const config = { apiRoutes: ["auth.me"] };', "root", {
        allowMissingDefault: true,
      }).apiRoutes,
    ).toEqual(["auth.me"]);
  });
});
