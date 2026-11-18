import { describe, expect, it } from "vitest";
import type { BookFacts, BookRoute, ProofLine, ProofResult, TestResultsStore } from "../contracts";
import { matchApps } from "../apps";
import { resolveOwnership } from "../ownership";
import {
  app,
  codeFile,
  facts as buildFacts,
  feature,
  page,
  row,
  step,
  task,
  written as buildWritten,
} from "../../tests/support/written-model";
import {
  annotationsFrom,
  buildCollectedFiles,
  normalizeRoutePath,
  routeMatches,
  type CollectedInput,
} from "./index";

function route(
  method: string,
  path: string,
  handlerFile: string | null,
  sourceFile: string | null,
  isPage = false,
): BookRoute {
  return {
    method,
    path,
    name: null,
    sourceFile,
    handler: "h",
    controller: null,
    action: null,
    handlerFile,
    middleware: [],
    auth: { required: false, userTypes: [] },
    isPage,
    description: null,
  };
}

function proof(
  ref: string,
  criterion: string,
  file: string,
  line: number | null,
  name = "a test",
): ProofLine {
  const [feature = "", flow = ""] = ref.split("/");

  return {
    feature,
    flow,
    ref,
    criterion,
    test: line === null ? null : { name, line },
    at: { file, line: (line ?? 2) - 1, column: null },
  };
}

function result(
  ref: string,
  criterion: string,
  testFile: string,
  line: number,
  outcome: ProofResult["outcome"],
  hash = "h1",
): ProofResult {
  const [feature = "", flow = ""] = ref.split("/");

  return {
    feature,
    flow,
    criterion,
    testFile,
    testName: "suite > a test",
    line,
    outcome,
    durationMs: 1,
    ranAt: "2026-11-16T00:00:00.000Z",
    testFileHash: hash,
  };
}

/** A small shop: catalog and orders, a client site and a mobile app. */
function world(
  overrides: {
    facts?: Partial<BookFacts>;
    proofs?: ProofLine[];
    results?: TestResultsStore | null;
  } = {},
): CollectedInput {
  const facts = buildFacts(
    [
      codeFile("src/app/catalog/routes.ts", ["src/app/catalog/list.controller.ts"], {
        type: "routes",
      }),
      codeFile("src/app/catalog/list.controller.ts", ["src/app/catalog/repo.ts"], {
        type: "controller",
      }),
      codeFile("src/app/catalog/repo.ts", ["src/app/shared/money.ts"]),
      codeFile("src/app/catalog/dead.ts"),
      codeFile("src/app/catalog/tests/list.test.ts", ["src/app/catalog/repo.ts"], { type: "spec" }),
      codeFile("src/app/orders/routes.ts", ["src/app/orders/place.controller.ts"], {
        type: "routes",
      }),
      codeFile("src/app/orders/place.controller.ts", [
        "src/app/catalog/repo.ts",
        "src/app/orders/confirm.mail.ts",
      ]),
      codeFile("src/app/orders/confirm.mail.ts", [], { type: "mail" }),
      codeFile("src/app/shared/money.ts"),
      codeFile(
        "src/web/$sites/client/products/show.page.tsx",
        ["src/web/$sites/client/products/show.setup.ts"],
        { type: "page" },
      ),
      codeFile("src/web/$sites/client/products/show.setup.ts", ["src/app/catalog/repo.ts"], {
        type: "setup",
      }),
      codeFile("src/web/$sites/client/layout.tsx", [], { type: "layout" }),
      codeFile("mobile/app/products/[id].tsx", [], { type: "component", mobileApp: "mobile" }),
    ],
    {
      routes: [
        route(
          "GET",
          "/api/products",
          "src/app/catalog/list.controller.ts",
          "src/app/catalog/routes.ts",
        ),
        route(
          "POST",
          "/api/orders",
          "src/app/orders/place.controller.ts",
          "src/app/orders/routes.ts",
        ),
        route("GET", "/products/:id", "src/web/$sites/client/products/show.page.tsx", null, true),
      ],
      sites: [{ id: "client", root: "src/web/$sites/client", basePath: null }],
      pages: [
        {
          site: "client",
          route: "/products/:id",
          name: null,
          file: "src/web/$sites/client/products/show.page.tsx",
          setupFile: "src/web/$sites/client/products/show.setup.ts",
          layouts: ["src/web/$sites/client/layout.tsx"],
          loaders: [],
          actions: [],
          requires: [],
          reachedFrom: null,
        },
      ],
      mobile: [
        {
          id: "mobile",
          root: "mobile",
          routing: "files",
          routesDir: "mobile/app",
          screens: [
            { route: "/products/[id]/", file: "mobile/app/products/[id].tsx", layouts: [] },
          ],
        },
      ],
      named: [{ type: "mail", name: "order-confirmation", file: "src/app/orders/confirm.mail.ts" }],
      tests: ["src/app/catalog/tests/list.test.ts"],
      ...overrides.facts,
    },
  );
  const written = buildWritten({
    features: [
      feature({
        id: "catalog",
        folders: ["src/app/catalog", "src/web/$sites/client/products"],
        apps: ["web-client", "mobile"],
        version: "2.1",
        flows: [
          {
            id: "browse",
            steps: [step(1, "route", "GET /api/products"), step(2, "page", "/products/[id]")],
            criteria: [{ id: "AC-1" }, { id: "AC-2", app: "mobile" }, { id: "AC-3" }],
          },
        ],
        changelog: [
          { version: "2.1", word: "fixed" },
          { version: "2.0", release: "1.1.0", date: "2026-10-20" },
          { version: "1.0", release: "1.0.0", date: "2026-10-01" },
        ],
      }),
      feature({
        id: "orders",
        folders: ["src/app/orders"],
        apps: ["web-client"],
        flows: [
          {
            id: "place",
            steps: [
              step(1, "route", "POST /api/orders"),
              step(2, "outside service", "bank"),
              step(3, "mail", "order-confirmation"),
              step(4, "affects", "catalog/browse"),
              step(5, "affects", "catalog/nope"),
              step(6, "job", "missing-job"),
              step(7, "route", "DELETE /api/orders"),
            ],
          },
        ],
      }),
    ],
    apps: [
      app("mobile", "mobile", "mobile", {
        screens: [
          page("mobile", "product", "/products/[id]", [row("Details", "catalog/browse")], "screen"),
        ],
      }),
      app("web-client", "site", "src/web/$sites/client", {
        layouts: [
          {
            file: "grimoire/apps/web-client/layouts/site.md",
            app: "web-client",
            id: "site",
            origin: null,
            heading: null,
            blocks: [row("Cart count", "orders/place"), row("Header", null)],
          },
        ],
        pages: [
          page("web-client", "product", "/products/:id", [
            row("Details", "catalog/browse"),
            row("Order", "orders/place"),
          ]),
        ],
      }),
    ],
    tasks: [
      task("T-15", "open", "in progress"),
      task("T-2", "open", "open", { decisionNeeded: "one list or many?" }),
      task("T-9", "open", "waiting for approval"),
      task("T-1", "done", "done", { shipped: { feature: "catalog", version: "2.1" } }),
    ],
  });

  return {
    written,
    facts,
    ownership: resolveOwnership(written, facts),
    apps: matchApps(written.apps, facts),
    proofs: overrides.proofs ?? [],
    results: overrides.results ?? null,
    testHashes: { "src/app/catalog/tests/list.test.ts": "h1" },
  };
}

describe("normalizeRoutePath", () => {
  it("writes params one way and drops a trailing slash", () => {
    expect(normalizeRoutePath("/products/[id]/")).toBe("/products/:id");
    expect(normalizeRoutePath("/products/:id")).toBe("/products/:id");
    expect(normalizeRoutePath("/docs/[...slug]")).toBe("/docs/:slug");
    expect(normalizeRoutePath("/")).toBe("/");
  });
});

describe("buildCollectedFiles: flow book maps", () => {
  it("lists the files behind a route step: the handler's closure and the routes file alone", () => {
    const collected = buildCollectedFiles(world());
    const [routeStep] = collected.flows["catalog/browse"]?.steps ?? [];

    expect(routeStep).toEqual({
      index: 1,
      type: "route",
      target: "GET /api/products",
      found: true,
      entry: "src/app/catalog/list.controller.ts",
      entries: ["src/app/catalog/list.controller.ts", "src/app/catalog/routes.ts"],
      direct: ["src/app/catalog/repo.ts"],
      files: [
        "src/app/catalog/list.controller.ts",
        "src/app/catalog/repo.ts",
        "src/app/catalog/routes.ts",
        "src/app/shared/money.ts",
      ],
      typeOnlyFiles: [],
    });
  });

  it("keeps type-only reach out of a step's files but still counts it as reached", () => {
    const input = world();
    const controller = input.facts.files.find(
      (file) => file.file === "src/app/catalog/list.controller.ts",
    );
    const repo = input.facts.files.find((file) => file.file === "src/app/catalog/repo.ts");

    controller?.imports.push({
      specifier: "../shared/money",
      file: "src/app/shared/money.ts",
      typeOnly: true,
    });
    // `repo` now reaches `money` only through a type, and `controller` also imports it directly as a type.
    if (repo) repo.imports = [{ ...repo.imports[0]!, typeOnly: true }];

    const collected = buildCollectedFiles(input);
    const routeStep = collected.flows["catalog/browse"]?.steps[0];

    expect(routeStep?.direct).toEqual(["src/app/catalog/repo.ts", "src/app/shared/money.ts"]);
    expect(routeStep?.files).toEqual([
      "src/app/catalog/list.controller.ts",
      "src/app/catalog/repo.ts",
      "src/app/catalog/routes.ts",
    ]);
    expect(routeStep?.typeOnlyFiles).toEqual(["src/app/shared/money.ts"]);
    // Coverage counts the type-only reach: `money` is not reported as unreached.
    expect(collected.features["catalog"]?.unreached ?? []).not.toContain("src/app/shared/money.ts");
  });

  it("matches a page step against pages and screens of the feature's apps, layouts left out", () => {
    const collected = buildCollectedFiles(world());
    const pageStep = collected.flows["catalog/browse"]?.steps[1];

    expect(pageStep?.found).toBe(true);
    expect(pageStep?.entry).toBe("src/web/$sites/client/products/show.page.tsx");
    expect(pageStep?.files).toEqual([
      "mobile/app/products/[id].tsx",
      "src/app/catalog/repo.ts",
      "src/app/shared/money.ts",
      "src/web/$sites/client/products/show.page.tsx",
      "src/web/$sites/client/products/show.setup.ts",
    ]);
  });

  it("limits a scoped page step to its app", () => {
    const input = world();
    const catalog = input.written.features[0];

    catalog?.flows[0]?.steps.push(
      step(3, "page", "/products/[id]", "mobile"),
      step(4, "page", "/products/[id]", "web-client"),
      step(5, "page", "/products/[id]", "web-admin"),
    );

    const steps = buildCollectedFiles(input).flows["catalog/browse"]?.steps ?? [];

    expect(steps[2]).toMatchObject({
      target: "/products/[id] [mobile]",
      found: true,
      entry: "mobile/app/products/[id].tsx",
      files: ["mobile/app/products/[id].tsx"],
    });
    expect(steps[3]).toMatchObject({
      target: "/products/[id] [web-client]",
      entry: "src/web/$sites/client/products/show.page.tsx",
    });
    expect(steps[3]?.files).not.toContain("mobile/app/products/[id].tsx");
    expect(steps[4]).toMatchObject({ found: false, entry: null, files: [] });
  });

  it("does not match a page of an app the feature does not list", () => {
    const input = world();
    const orders = input.written.features[1];

    orders?.flows[0]?.steps.push(step(8, "page", "/products/:id"));
    const readme = orders?.readme;

    if (readme) readme.apps = [];

    const steps = buildCollectedFiles(input).flows["orders/place"]?.steps ?? [];

    expect(steps[7]).toMatchObject({ found: false, entry: null, files: [] });
  });

  it("resolves named, outside service, affects and missing steps", () => {
    const steps = buildCollectedFiles(world()).flows["orders/place"]?.steps ?? [];

    expect(steps.map((item) => [item.type, item.found, item.entry])).toEqual([
      ["route", true, "src/app/orders/place.controller.ts"],
      ["outside service", null, null],
      ["mail", true, "src/app/orders/confirm.mail.ts"],
      ["affects", true, null],
      ["affects", false, null],
      ["job", false, null],
      ["route", false, null],
    ]);
    expect(steps[2]?.files).toEqual(["src/app/orders/confirm.mail.ts"]);
  });

  it("leaves route steps unknown when there are no route facts", () => {
    const steps =
      buildCollectedFiles(world({ facts: { routes: null } })).flows["orders/place"]?.steps ?? [];

    expect(steps[0]).toMatchObject({ found: null, entry: null, files: [] });
  });

  it("matches route params written either way, a trailing slash and any method case", () => {
    const steps =
      buildCollectedFiles(
        world({
          facts: {
            routes: [route("post", "/api/orders/:id/", null, "src/app/orders/routes.ts")],
          },
        }),
      ).flows["orders/place"]?.steps ?? [];

    expect(steps[0]).toMatchObject({ found: false });

    const bracketed = world({
      facts: { routes: [route("post", "/api/orders/[order]/", null, "src/app/orders/routes.ts")] },
    });
    const flow = bracketed.written.features[1]?.flows[0];

    if (flow?.steps[0]?.route) flow.steps[0].route = { method: "POST", path: "/api/orders/:order" };

    expect(buildCollectedFiles(bracketed).flows["orders/place"]?.steps[0]).toMatchObject({
      found: true,
      entry: "src/app/orders/routes.ts",
    });
  });

  it("shares routeMatches with scry: params, trailing slash, method case and ALL", () => {
    expect(routeMatches({ method: "get", path: "/products/[id]/" }, "GET", "/products/:id")).toBe(
      true,
    );
    expect(routeMatches({ method: "ALL", path: "/a" }, "delete", "/a/")).toBe(true);
    expect(routeMatches({ method: "GET", path: "/a" }, "ALL", "/a")).toBe(true);
    expect(routeMatches({ method: "GET", path: "/a/:id" }, "POST", "/a/:id")).toBe(false);
    expect(routeMatches({ method: "GET", path: "/a/:id" }, "GET", "/a")).toBe(false);
  });

  it("matches a route registered for ALL methods", () => {
    const steps =
      buildCollectedFiles(
        world({
          facts: { routes: [route("ALL", "/api/orders", null, "src/app/orders/routes.ts")] },
        }),
      ).flows["orders/place"]?.steps ?? [];

    expect(steps[0]).toMatchObject({
      found: true,
      entry: "src/app/orders/routes.ts",
      files: ["src/app/orders/routes.ts"],
    });
  });

  it("gives each criterion its tests and status from the results store", () => {
    const file = "src/app/catalog/tests/list.test.ts";
    const collected = buildCollectedFiles(
      world({
        proofs: [
          proof("catalog/browse", "AC-1", file, 10),
          proof("catalog/browse", "AC-2", file, 20),
          proof("catalog/browse", "AC-3", file, 30),
          proof("catalog/browse", "AC-3", file, 40),
          proof("catalog/browse", "AC-1", file, null),
        ],
        results: {
          schemaVersion: 1,
          updatedAt: "2026-11-16T00:00:00.000Z",
          runner: "vitest",
          results: [
            result("catalog/browse", "AC-1", file, 10, "pass"),
            result("catalog/browse", "AC-2", file, 20, "pass", "old-hash"),
            result("catalog/browse", "AC-3", file, 30, "fail"),
          ],
        },
      }),
    );
    const criteria = collected.flows["catalog/browse"]?.criteria ?? [];

    expect(criteria.map((criterion) => [criterion.id, criterion.app, criterion.status])).toEqual([
      ["AC-1", null, "pass"],
      ["AC-2", "mobile", "stale"],
      ["AC-3", null, "fail"],
    ]);
    expect(criteria[2]?.tests).toEqual([
      { file, line: 30, name: "a test", result: "fail", stale: false },
      { file, line: 40, name: "a test", result: "not-run", stale: false },
    ]);
  });

  it("finds a result by test name when the line moved", () => {
    const file = "src/app/catalog/tests/list.test.ts";
    const criteria =
      buildCollectedFiles(
        world({
          proofs: [proof("catalog/browse", "AC-1", file, 12)],
          results: {
            schemaVersion: 1,
            updatedAt: "2026-11-16T00:00:00.000Z",
            runner: "vitest",
            results: [result("catalog/browse", "AC-1", file, 10, "pass")],
          },
        }),
      ).flows["catalog/browse"]?.criteria ?? [];

    expect(criteria[0]?.tests[0]).toMatchObject({ result: "pass", line: 12 });
  });

  it("marks every criterion not run or no test when no results exist", () => {
    const file = "src/app/catalog/tests/list.test.ts";
    const criteria =
      buildCollectedFiles(world({ proofs: [proof("catalog/browse", "AC-1", file, 10)] })).flows[
        "catalog/browse"
      ]?.criteria ?? [];

    expect(criteria.map((criterion) => criterion.status)).toEqual([
      "not-run",
      "no-test",
      "no-test",
    ]);
  });

  it("lists the layout, page and screen rows that show the flow", () => {
    const collected = buildCollectedFiles(world());

    expect(collected.flows["catalog/browse"]?.shownBy).toEqual([
      {
        app: "mobile",
        type: "screen",
        id: "product",
        block: "Details",
        file: "grimoire/apps/mobile/screens/product/README.md",
      },
      {
        app: "web-client",
        type: "page",
        id: "product",
        block: "Details",
        file: "grimoire/apps/web-client/pages/product/README.md",
      },
    ]);
    expect(
      collected.flows["orders/place"]?.shownBy.map(
        (shown) => `${shown.type}:${shown.id}:${shown.block}`,
      ),
    ).toEqual(["layout:site:Cart count", "page:product:Order"]);
  });
});

describe("buildCollectedFiles: feature book maps", () => {
  it("lists own, borrowed, routes, pages per app and unreached files", () => {
    const collected = buildCollectedFiles(world());

    expect(collected.features.catalog).toEqual({
      schemaVersion: 1,
      feature: "catalog",
      own: [
        "src/app/catalog/dead.ts",
        "src/app/catalog/list.controller.ts",
        "src/app/catalog/repo.ts",
        "src/app/catalog/routes.ts",
        "src/web/$sites/client/products/show.page.tsx",
        "src/web/$sites/client/products/show.setup.ts",
      ],
      borrowed: [{ file: "src/app/shared/money.ts", owner: null, by: ["src/app/catalog/repo.ts"] }],
      routes: [
        {
          method: "GET",
          path: "/api/products",
          name: null,
          file: "src/app/catalog/list.controller.ts",
        },
      ],
      pages: {
        "web-client": [
          {
            route: "/products/:id",
            file: "src/web/$sites/client/products/show.page.tsx",
            type: "page",
          },
        ],
      },
      unreached: ["src/app/catalog/dead.ts"],
    });
    expect(collected.features.orders?.borrowed).toEqual([
      {
        file: "src/app/catalog/repo.ts",
        owner: "catalog",
        by: ["src/app/orders/place.controller.ts"],
      },
    ]);
  });

  it("keys pages by the adapter's site id when no written app matches", () => {
    const input = world();
    input.apps = {};

    expect(Object.keys(buildCollectedFiles(input).features.catalog?.pages ?? {})).toEqual([
      "client",
    ]);
  });
});

describe("buildCollectedFiles: indexes", () => {
  it("lists features with their releases, dates from the changelog, newest first", () => {
    const { featuresIndex } = buildCollectedFiles(world());

    expect(featuresIndex.features.map((item) => item.id)).toEqual(["catalog", "orders"]);
    expect(featuresIndex.features[0]).toEqual({
      id: "catalog",
      title: "The catalog feature",
      status: "shipped",
      version: "2.1",
      updated: "2026-11-01",
      apps: ["web-client", "mobile"],
      origin: null,
      flows: [{ id: "browse", status: "shipped", since: "1.0" }],
      releases: [
        { version: "2.0", release: "1.1.0", date: "2026-10-20" },
        { version: "1.0", release: "1.0.0", date: "2026-10-01" },
      ],
    });
  });

  it("leaves out a feature folder with no README", () => {
    const input = world();
    input.written.features.push(feature({ id: "broken", readme: false }));

    const collected = buildCollectedFiles(input);

    expect(collected.featuresIndex.features.map((item) => item.id)).toEqual(["catalog", "orders"]);
    expect(collected.features.broken?.own).toEqual([]);
  });

  it("splits tasks into open, waiting and done, sorted by number", () => {
    const { tasksIndex } = buildCollectedFiles(world());

    expect(tasksIndex.open.map((item) => item.id)).toEqual(["T-2", "T-9", "T-15"]);
    expect(tasksIndex.waiting.map((item) => item.id)).toEqual(["T-2", "T-9"]);
    expect(tasksIndex.done).toEqual([
      {
        id: "T-1",
        title: "Task T-1",
        type: "bug",
        status: "done",
        feature: null,
        flow: null,
        apps: [],
        file: "grimoire/tasks/done/2026-11/T-1-x.md",
        shipped: { feature: "catalog", version: "2.1" },
        decisionNeeded: null,
      },
    ]);
  });
});

describe("annotationsFrom", () => {
  it("gives each file its owner, borrowers and the flows that reach it", () => {
    const input = world();
    const annotations = annotationsFrom(input, buildCollectedFiles(input), {
      tests: { "a.test.ts": "x" },
    });

    expect(annotations.writtenHash).toBe("written-hash");
    expect(annotations.tests).toEqual({ "a.test.ts": "x" });
    expect(annotations.files["src/app/catalog/repo.ts"]).toEqual({
      feature: "catalog",
      borrowedBy: ["orders"],
      flows: ["catalog/browse", "orders/place"],
    });
    expect(annotations.files["src/app/catalog/dead.ts"]).toEqual({
      feature: "catalog",
      borrowedBy: [],
      flows: [],
    });
    expect(Object.keys(annotations.files)).toHaveLength(input.facts.files.length);
  });
});
