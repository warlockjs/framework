/**
 * `checkGrimoire()` on the shop fixture: the base result (golden files) and
 * one broken copy per rule of the check.
 *
 * Rewrite the goldens after an intended change with:
 * `GRIMOIRE_UPDATE_GOLDEN=1 npx vitest run tests/check/check.spec.ts`
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkGrimoire, formatCheckReport } from "../../src/check";
import type { BookFacts, GrimoireCheckReport, GrimoireFinding } from "../../src/contracts";
import { openGrimoire } from "../../src/workspace";
import { createShopAdapter, shopFacts } from "../fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../support/copy-fixture";

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../golden/check");
const copies: FixtureCopy[] = [];

afterEach(() => {
  for (const copy of copies.splice(0)) copy.remove();
});

/** Open a copy of the fixture (after `edit`) and check it. */
async function checkCopy(
  edit: (copy: FixtureCopy) => void = () => undefined,
  facts: BookFacts = shopFacts,
): Promise<GrimoireCheckReport> {
  const copy = copyFixture();

  copies.push(copy);
  edit(copy);

  return checkGrimoire(
    await openGrimoire(copy.root, createShopAdapter(facts), { routes: "fresh", write: false }),
  );
}

function line(finding: GrimoireFinding): string {
  return `${finding.code} ${finding.at ? `${finding.at.file}:${finding.at.line}` : "-"} ${finding.expected ? "expected" : finding.severity}`;
}

/** The facts with one change. */
function factsWith(change: (facts: BookFacts) => void): BookFacts {
  const facts = structuredClone(shopFacts);

  change(facts);

  return facts;
}

function matchGolden(name: string, content: string): void {
  const file = path.join(GOLDEN, name);

  if (process.env["GRIMOIRE_UPDATE_GOLDEN"] === "1") {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, content);
  }

  expect(content).toBe(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

describe("checkGrimoire on the shop fixture", () => {
  it("passes, with the warnings and expected findings the fixture is built to show", async () => {
    const report = await checkCopy();

    expect(report.ok).toBe(true);
    expect(report.counts).toEqual({ errors: 0, warnings: 8, expected: 8 });
    expect(
      report.findings
        .filter((finding) => !finding.expected)
        .map((finding) => `${finding.code} ${finding.message}`),
    ).toEqual([
      "GR4001 auth/login AC-1 has no test",
      "GR4001 auth/sign-up AC-1 has no test",
      "GR4001 auth/sign-up AC-2 has no test",
      "GR4001 catalog/browse-products AC-1 has no test",
      "GR4001 catalog/browse-products AC-2 has no test",
      "GR4001 catalog/browse-products AC-3 has no test",
      "GR4001 catalog/new-arrivals AC-3 has no test",
      "GR4001 orders/place-order AC-4 has no test",
    ]);
    expect(
      report.findings
        .filter((finding) => finding.expected)
        .map((finding) => `${finding.code} ${finding.message}`),
    ).toEqual([
      "GR6007 catalog/wishlist is since 3.0, newer than catalog 2.1",
      'GR2001 route step "POST /api/wishlist" matches no route',
      'GR2004 notification step "wishlist-price-drop" matches no notification',
      `GR2002 page step "/wishlist" matches no page or screen of the feature's apps`,
      "GR4001 catalog/wishlist AC-1 has no test",
      "GR4001 catalog/wishlist AC-2 has no test",
      "GR4001 catalog/wishlist AC-3 has no test",
      "GR4001 catalog/wishlist AC-4 has no test",
    ]);

    matchGolden("report.json", `${JSON.stringify({ ...report, root: "<root>" }, null, 2)}\n`);
    matchGolden("report.txt", `${formatCheckReport(report).join("\n")}\n`);
    matchGolden("report.all.txt", `${formatCheckReport(report, { all: true }).join("\n")}\n`);
  });

  it("matches route steps the way scry --route does: [id] for :id, a trailing slash ignored", async () => {
    const copy = copyFixture();

    copies.push(copy);
    copy.replace(
      "grimoire/features/catalog/flows/browse-products.md",
      "GET /api/products/:id —",
      "GET /api/products/[id]/ —",
    );
    copy.replace(
      "grimoire/features/catalog/flows/new-arrivals.md",
      "GET /api/products/new-arrivals",
      "GET /api/products/new-arrivals/",
    );

    const snapshot = await openGrimoire(copy.root, createShopAdapter(), {
      routes: "fresh",
      write: false,
    });
    const report = checkGrimoire(snapshot);

    expect(report.counts).toEqual({ errors: 0, warnings: 8, expected: 8 });
    expect(
      report.findings.filter((finding) => finding.code === "GR2001" && !finding.expected),
    ).toEqual([]);
    expect(snapshot.collected.flows["catalog/browse-products"]?.steps[2]).toMatchObject({
      target: "GET /api/products/[id]/",
      found: true,
    });
    expect(snapshot.collected.flows["catalog/new-arrivals"]?.steps[1]).toMatchObject({
      found: true,
      entry: "src/app/catalog/controllers/new-arrivals.controller.ts",
    });
  });

  const AUTH = "grimoire/features/auth";
  const CATALOG = "grimoire/features/catalog";
  const ORDERS = "grimoire/features/orders";
  const PLACE_ORDER = `${ORDERS}/flows/place-order.md`;

  const cases: {
    title: string;
    edit?: (copy: FixtureCopy) => void;
    facts?: BookFacts;
    expect: string[];
  }[] = [
    {
      title: "GR2001 a route step that names no route",
      edit: (copy) => copy.replace(PLACE_ORDER, "POST /api/orders", "POST /api/order"),
      // The handler's files are reached by no other step now.
      expect: [
        `GR2001 ${PLACE_ORDER}:12 error`,
        "GR3006 src/app/orders/controllers/place-order.controller.ts:1 warning",
        "GR3006 src/app/orders/routes.ts:1 warning",
        "GR3006 src/app/orders/services/place-order.service.ts:1 warning",
      ],
    },
    {
      title: "GR2002 a page step that names no page of the feature's apps",
      edit: (copy) =>
        copy.replace(
          `${CATALOG}/flows/browse-products.md`,
          "page           /products/:id",
          "page           /product/:id",
        ),
      expect: [`GR2002 ${CATALOG}/flows/browse-products.md:12 error`],
    },
    {
      title: "GR2003 a mail step that names no mail",
      edit: (copy) =>
        copy.replace(
          PLACE_ORDER,
          "mail              order-confirmation",
          "mail              order-confirm",
        ),
      expect: [`GR2003 ${PLACE_ORDER}:16 error`],
    },
    {
      title: "GR2004 a notification step that names no notification",
      edit: (copy) =>
        copy.replace(
          PLACE_ORDER,
          "notification      order-shipped",
          "notification      order-sent",
        ),
      expect: [
        `GR2004 ${PLACE_ORDER}:18 error`,
        `GR3006 src/app/orders/notifications/order-shipped.notification.ts:1 warning`,
      ],
    },
    {
      title: "GR2005 a job step that names no job",
      edit: (copy) =>
        copy.replace(
          PLACE_ORDER,
          "job               send-receipt",
          "job               send-receipts",
        ),
      expect: [`GR2005 ${PLACE_ORDER}:17 error`],
    },
    {
      title: "GR2006 an event step that names no event",
      edit: (copy) =>
        copy.replace(
          PLACE_ORDER,
          "event             order.placed",
          "event             order.created",
        ),
      expect: [`GR2006 ${PLACE_ORDER}:14 error`],
    },
    {
      title: "GR2007 an affects step that names no flow",
      edit: (copy) =>
        copy.replace(
          PLACE_ORDER,
          "affects           catalog/browse-products",
          "affects           catalog/stock",
        ),
      expect: [`GR2007 ${PLACE_ORDER}:15 error`],
    },
    {
      title: "GR2008 a feature that names an app with no folder",
      edit: (copy) =>
        copy.replace(`${AUTH}/README.md`, "apps: [web-client, mobile]", "apps: [web-client, tv]"),
      expect: [`GR2008 ${AUTH}/README.md:8 error`],
    },
    {
      title: "GR2009 a criterion scoped to an app its feature does not list",
      edit: (copy) =>
        copy.replace(`${AUTH}/flows/login.md`, "- AC-1   valid", "- AC-1 [web-admin]   valid"),
      expect: [`GR2009 ${AUTH}/flows/login.md:29 warning`],
    },
    {
      title: "GR2010 a changelog entry that names no flow",
      edit: (copy) =>
        copy.replace(`${CATALOG}/CHANGELOG.md`, "fixed     new-arrivals:", "fixed     newest:"),
      expect: [`GR2010 ${CATALOG}/CHANGELOG.md:2 error`],
    },
    {
      title: "GR2011 a changelog entry that names a criterion the flow lacks",
      edit: (copy) => copy.replace(`${CATALOG}/CHANGELOG.md`, "(AC-2)", "(AC-9)"),
      expect: [`GR2011 ${CATALOG}/CHANGELOG.md:2 error`],
    },
    {
      title: "GR2012 a README relation that names no flow",
      edit: (copy) => copy.replace(`${CATALOG}/README.md`, "orders/place-order", "orders/pay"),
      expect: [`GR2012 ${CATALOG}/README.md:21 error`],
    },
    {
      title: "GR3001 a source file with no header sentence",
      facts: factsWith((facts) => {
        const file = facts.files.find(
          (item) => item.file === "src/app/catalog/models/product.model.ts",
        );

        if (file) file.about = null;
      }),
      expect: ["GR3001 src/app/catalog/models/product.model.ts:1 warning"],
    },
    {
      title: "GR3002 a src/app file no feature owns",
      edit: (copy) =>
        copy.replace(
          `${AUTH}/README.md`,
          "folders: [src/app/auth]",
          "folders: [src/app/auth/controllers]",
        ),
      expect: [
        "GR3002 src/app/auth/routes.ts:1 warning",
        "GR3002 src/app/auth/services/login.service.ts:1 warning",
        "GR3002 src/app/auth/services/register.service.ts:1 warning",
      ],
    },
    {
      title: "GR3003 a file two features claim",
      facts: factsWith((facts) => {
        const file = facts.files.find(
          (item) => item.file === "src/app/shared/jobs/delete-unverified.job.ts",
        );

        if (file) file.tags = { feature: ["auth", "orders"] };
      }),
      expect: ["GR3003 src/app/shared/jobs/delete-unverified.job.ts:1 error"],
    },
    {
      title: "GR3004 a @feature tag that names no feature",
      facts: factsWith((facts) => {
        const file = facts.files.find(
          (item) => item.file === "src/app/shared/jobs/delete-unverified.job.ts",
        );

        if (file) file.tags = { feature: ["accounts"] };
      }),
      expect: ["GR3004 src/app/shared/jobs/delete-unverified.job.ts:1 error"],
    },
    {
      title: "GR3005 a folders entry that does not exist",
      edit: (copy) =>
        copy.replace(
          `${CATALOG}/README.md`,
          "src/web/$sites/client/products]",
          "src/web/$sites/client/product]",
        ),
      expect: [`GR3005 ${CATALOG}/README.md:8 error`],
    },
    {
      title: "GR3006 an own file no flow reaches",
      edit: (copy) =>
        copy.replace(
          PLACE_ORDER,
          "8. notification      order-shipped",
          "8. outside service   push service",
        ),
      expect: ["GR3006 src/app/orders/notifications/order-shipped.notification.ts:1 warning"],
    },
    {
      title: "GR4002 a @proves line that names no criterion",
      edit: (copy) => copy.replace("e2e/checkout.e2e.ts", "AC-3", "AC-9"),
      expect: ["GR4002 e2e/checkout.e2e.ts:5 error", `GR4001 ${PLACE_ORDER}:41 warning`],
    },
    {
      title: "GR4003 a malformed @proves line",
      edit: (copy) =>
        copy.replace(
          "e2e/checkout.e2e.ts",
          "// @proves orders/place-order AC-3",
          "// @proves orders AC-3",
        ),
      expect: ["GR4003 e2e/checkout.e2e.ts:5 error", `GR4001 ${PLACE_ORDER}:41 warning`],
    },
    {
      title: "GR6004 a README updated before its newest changelog section",
      edit: (copy) =>
        copy.replace(`${AUTH}/README.md`, "updated: 2026-10-01", "updated: 2026-09-30"),
      expect: [`GR6004 ${AUTH}/README.md:7 error`],
    },
    {
      title: "GR6005 a README version that differs from the newest entry",
      edit: (copy) => copy.replace(`${ORDERS}/README.md`, "version: 1.0", "version: 1.1"),
      expect: [`GR6005 ${ORDERS}/README.md:5 error`],
    },
    {
      title: "GR6006 a change word on the wrong version step",
      edit: (copy) => copy.replace(`${CATALOG}/CHANGELOG.md`, "2.1  fixed", "2.1  added"),
      expect: [`GR6006 ${CATALOG}/CHANGELOG.md:2 warning`],
    },
    {
      title: "GR6007 a shipped flow newer than its feature",
      edit: (copy) => copy.replace(`${AUTH}/flows/login.md`, "since: 1.0", "since: 1.1"),
      expect: [`GR6007 ${AUTH}/flows/login.md:3 error`],
    },
    {
      title: "GR6008 a proposed whole-number version with no brief (expected)",
      edit: (copy) => rmSync(path.join(copy.root, ...`${CATALOG}/versions/v3.md`.split("/"))),
      // The wishlist task names the brief too.
      expect: [
        "GR7005 grimoire/tasks/open/T-014-wishlist.md:14 warning",
        `GR6008 ${CATALOG}/flows/wishlist.md:3 expected`,
      ],
    },
  ];

  let base: Promise<Set<string>> | null = null;

  for (const testCase of cases) {
    it(testCase.title, async () => {
      base ??= checkCopy().then((report) => new Set(report.findings.map(line)));

      const baseLines = await base;
      const report = await checkCopy(testCase.edit, testCase.facts);
      const added = report.findings.map(line).filter((item) => !baseLines.has(item));

      expect(added).toEqual(testCase.expect);
      expect(report.ok).toBe(!added.some((item) => item.endsWith(" error")));
    });
  }

  it("GR8003 a check against cached route facts whose routes file changed", async () => {
    const copy = copyFixture();

    copies.push(copy);
    await openGrimoire(copy.root, createShopAdapter(), { routes: "fresh" });
    copy.write(
      "src/app/orders/routes.ts",
      `${copy.read("src/app/orders/routes.ts")}\n// changed\n`,
    );

    const report = checkGrimoire(
      await openGrimoire(copy.root, createShopAdapter(), { routes: "cached", write: false }),
    );

    expect(report.routes).toBe("stale");
    expect(report.findings.filter((finding) => finding.code === "GR8003").map(line)).toEqual([
      "GR8003 - warning",
    ]);
    expect(report.ok).toBe(true);
  });
});
