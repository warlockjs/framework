import { describe, expect, it } from "vitest";
import {
  bookmap,
  entry,
  feature,
  flow,
  snapshot,
  withApps,
} from "../../../tests/check/snapshot-builder";
import type { GrimoireFinding, GrimoireSnapshot } from "../../contracts";
import { checkAppNames, checkChangelogLinks, checkRelations, checkSteps } from "./links";

function summary(findings: GrimoireFinding[]): string[] {
  return findings.map(
    (finding) => `${finding.code} ${finding.at?.file}:${finding.at?.line} ${finding.message}`,
  );
}

/** One feature `shop` with one flow of every step kind; `found` decides which steps matched. */
function stepsSnapshot(
  found: (boolean | null)[],
  status: "shipped" | "retired" = "shipped",
): GrimoireSnapshot {
  const order = flow("shop", "order", {
    status,
    steps: [
      ["route", "POST /api/orders"],
      ["page", "/cart"],
      ["mail", "order-confirmation"],
      ["notification", "order-shipped"],
      ["job", "send-receipt"],
      ["event", "order.placed"],
      ["affects", "catalog/browse"],
      ["outside service", "payment gateway"],
    ],
  });
  const target = snapshot();

  target.written.features = [feature("shop", { flows: [order] })];
  target.collected.flows[order.ref] = bookmap(order, found);

  return target;
}

describe("checkSteps", () => {
  it("reports nothing when every step matched", () => {
    expect(checkSteps(stepsSnapshot([true, true, true, true, true, true, true, null]))).toEqual([]);
  });

  it("GR2001–GR2007: one code per step kind that matched nothing", () => {
    const findings = checkSteps(
      stepsSnapshot([false, false, false, false, false, false, false, false]),
    );

    expect(summary(findings)).toEqual([
      'GR2001 grimoire/features/shop/flows/order.md:11 route step "POST /api/orders" matches no route',
      'GR2002 grimoire/features/shop/flows/order.md:12 page step "/cart" matches no page or screen of the feature\'s apps',
      'GR2003 grimoire/features/shop/flows/order.md:13 mail step "order-confirmation" matches no mail',
      'GR2004 grimoire/features/shop/flows/order.md:14 notification step "order-shipped" matches no notification',
      'GR2005 grimoire/features/shop/flows/order.md:15 job step "send-receipt" matches no job',
      'GR2006 grimoire/features/shop/flows/order.md:16 event step "order.placed" matches no event',
      'GR2007 grimoire/features/shop/flows/order.md:17 affects step "catalog/browse" names no feature or flow',
    ]);
    expect(findings[0]?.subject).toMatchObject({ feature: "shop", flow: "shop/order" });
    expect(findings.every((finding) => finding.severity === "error")).toBe(true);
  });

  it("skips retired flows, and the route and named steps when no route facts exist", () => {
    expect(checkSteps(stepsSnapshot(Array(8).fill(false), "retired"))).toEqual([]);

    const missing = stepsSnapshot(Array(8).fill(false));

    missing.routes = "missing";

    expect(checkSteps(missing).map((finding) => finding.code)).toEqual(["GR2002", "GR2007"]);
  });
});

describe("checkAppNames", () => {
  function appsSnapshot(
    apps: string[],
    featureApps: string[],
    differs: string[],
    criteria: (string | [string, string])[],
  ): GrimoireSnapshot {
    const target = withApps(snapshot(), apps);

    target.written.features = [
      feature("shop", { apps: featureApps, flows: [flow("shop", "order", { differs, criteria })] }),
    ];

    return target;
  }

  it("reports nothing when every app has a folder and the feature lists it", () => {
    expect(
      checkAppNames(
        appsSnapshot(["web", "mobile"], ["web", "mobile"], ["mobile"], ["AC-1", ["AC-2", "web"]]),
      ),
    ).toEqual([]);
  });

  it("GR2008: a feature, flow, criterion or task names an app with no folder", () => {
    const target = appsSnapshot(["web"], ["web", "tv"], ["tv"], [["AC-1", "watch"]]);

    target.written.tasks = [
      {
        file: "grimoire/tasks/open/T-1-x.md",
        folder: "open",
        month: null,
        id: { value: "T-1", at: { file: "grimoire/tasks/open/T-1-x.md", line: 2, column: null } },
        type: { value: "bug", at: { file: "grimoire/tasks/open/T-1-x.md", line: 3, column: null } },
        feature: null,
        flow: null,
        apps: [
          { value: "kiosk", at: { file: "grimoire/tasks/open/T-1-x.md", line: 4, column: null } },
        ],
        status: {
          value: "open",
          at: { file: "grimoire/tasks/open/T-1-x.md", line: 5, column: null },
        },
        shipped: null,
        heading: null,
        fields: [],
        decisionNeeded: null,
      },
    ];

    const findings = checkAppNames(target);

    expect(summary(findings)).toEqual([
      'GR2008 grimoire/features/shop/README.md:7 feature shop lists app "tv", which has no folder in grimoire/apps',
      'GR2008 grimoire/features/shop/flows/order.md:20 shop/order Differs by app names app "tv", which has no folder in grimoire/apps',
      'GR2008 grimoire/features/shop/flows/order.md:30 shop/order AC-1 names app "watch", which has no folder in grimoire/apps',
      'GR2008 grimoire/tasks/open/T-1-x.md:4 task T-1 names app "kiosk", which has no folder in grimoire/apps',
    ]);
    expect(findings[3]?.subject).toMatchObject({ task: "T-1", app: "kiosk", feature: null });
  });

  it("GR2009: a flow names an app its feature does not list", () => {
    const findings = checkAppNames(
      appsSnapshot(["web", "mobile"], ["web"], ["mobile"], [["AC-1", "mobile"]]),
    );

    expect(
      findings.map((finding) => `${finding.code} ${finding.severity} ${finding.message}`),
    ).toEqual([
      'GR2009 warning shop/order Differs by app names app "mobile", which feature shop does not list in apps',
      'GR2009 warning shop/order AC-1 names app "mobile", which feature shop does not list in apps',
    ]);
  });
});

describe("checkChangelogLinks", () => {
  function changelogSnapshot(flowId: string, criteria: string[]): GrimoireSnapshot {
    const target = snapshot();

    target.written.features = [
      feature("shop", {
        flows: [flow("shop", "order", { criteria: ["AC-1", "AC-2"] })],
        entries: [entry("1.1", "fixed", { flow: flowId, criteria })],
      }),
    ];

    return target;
  }

  it("reports nothing when the flow and its criteria exist", () => {
    expect(checkChangelogLinks(changelogSnapshot("order", ["AC-1", "AC-2"]))).toEqual([]);
  });

  it("GR2010: an entry names a flow the feature does not have", () => {
    expect(summary(checkChangelogLinks(changelogSnapshot("refund", ["AC-1"])))).toEqual([
      'GR2010 grimoire/features/x/CHANGELOG.md:2 changelog entry 1.1 fixed names flow "refund", which shop does not have',
    ]);
  });

  it("GR2011: an entry names a criterion the flow does not have", () => {
    const findings = checkChangelogLinks(changelogSnapshot("order", ["AC-1", "AC-7"]));

    expect(summary(findings)).toEqual([
      "GR2011 grimoire/features/x/CHANGELOG.md:2 changelog entry 1.1 fixed names AC-7, which shop/order does not have",
    ]);
    expect(findings[0]?.subject.flow).toBe("shop/order");
  });
});

describe("checkRelations", () => {
  function relationsSnapshot(refs: string[]): GrimoireSnapshot {
    const target = snapshot();

    target.written.features = [
      feature("shop", { relations: refs, flows: [flow("shop", "order")] }),
      feature("catalog", { flows: [flow("catalog", "browse")] }),
    ];

    return target;
  }

  it("reports nothing when every reference exists", () => {
    expect(checkRelations(relationsSnapshot(["catalog/browse", "catalog"]))).toEqual([]);
  });

  it("GR2012: a README relation names a flow or feature that does not exist", () => {
    expect(summary(checkRelations(relationsSnapshot(["catalog/stock", "billing"])))).toEqual([
      'GR2012 grimoire/features/shop/README.md:20 README of shop names "catalog/stock", which is no flow',
      'GR2012 grimoire/features/shop/README.md:21 README of shop names "billing", which is no feature',
    ]);
  });
});
