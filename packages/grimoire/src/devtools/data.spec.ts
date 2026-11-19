import { afterEach, describe, expect, it } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import type { GrimoireAppsAnswer, GrimoireFeaturesAnswer, GrimoireSummary } from "./data";
import { openGrimoire } from "../workspace";
import { checkGroups, checkPage, feature, flowAnswer, stepFiles } from "./data";
import { grimoireDevtoolsPanel } from "./index";

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

async function answer<Result>(route: string): Promise<Result> {
  copy = copyFixture();

  const panel = await grimoireDevtoolsPanel({
    root: copy.root,
    mode: "production",
    adapter: createShopAdapter(),
  });
  const found = panel.routes?.find((item) => item.path === route);

  return (await found?.handler({ params: {}, query: {}, body: undefined })) as Result;
}

describe("the listing routes of the Grimoire tab", () => {
  it("lists the features with their summary and flow headings", async () => {
    const { features } = await answer<GrimoireFeaturesAnswer>("/features");
    const catalog = features.find((feature) => feature.id === "catalog");

    expect(features.length).toBeGreaterThan(1);
    expect(catalog?.title).toBeTruthy();
    expect(catalog?.flows.length).toBeGreaterThan(0);
    expect(catalog?.flows.every((flow) => "heading" in flow)).toBe(true);
    expect(catalog?.flows.some((flow) => typeof flow.heading === "string")).toBe(true);
  });

  it("gives every page and screen a row with its route and whether it is confirmed", async () => {
    const { apps } = await answer<GrimoireAppsAnswer>("/apps");
    const client = apps.find((app) => app.id === "web-client");

    expect(client?.rows.map((row) => row.id).sort()).toEqual(
      [...(client?.pages ?? []), ...(client?.screens ?? [])].sort(),
    );

    const home = client?.rows.find((row) => row.id === "home");

    expect(home?.route).toBe("/");
    expect(home?.type).toBe("page");
    expect(home?.blocks).toBeGreaterThan(0);
    expect(home?.origin === null || ["confirmed", "inferred"].includes(home?.origin ?? "")).toBe(
      true,
    );
  });

  it("counts apps, pages, screens and releases in the summary", async () => {
    const summary = await answer<GrimoireSummary>("/summary");

    expect(summary.apps.apps).toBeGreaterThan(0);
    expect(summary.apps.pages).toBeGreaterThan(0);
    expect(summary.releases).toBeGreaterThanOrEqual(0);
  });
});

describe("the compact answers", () => {
  async function snapshot() {
    copy = copyFixture();

    return openGrimoire(copy.root, createShopAdapter(), { routes: "fresh", write: false });
  }

  it("answers a flow with step counts and no file lists", async () => {
    const answer = flowAnswer(await snapshot(), "catalog", "new-arrivals");

    expect(answer.feature.id).toBe("catalog");
    expect(answer.health.criteria.total).toBe(answer.bookmap.criteria.length);
    expect(answer.results.file).toBe("grimoire/book/test-results.json");

    for (const step of answer.bookmap.steps) {
      expect(step).not.toHaveProperty("files");
      expect(step).not.toHaveProperty("typeOnlyFiles");
      expect(step.direct.length).toBeLessThanOrEqual(50);
      expect(step.counts.direct).toBeGreaterThanOrEqual(step.direct.length);
      expect(step.counts.reachable).toBeGreaterThanOrEqual(step.counts.feature);
    }
  });

  it("answers a feature with its map, own files by module and the proof of each flow", async () => {
    const taken = await snapshot();
    const answer = feature(taken, "catalog");

    expect(answer.map.rows.map((row) => row.flow)).toContain("new-arrivals");

    const arrivals = answer.map.rows.find((row) => row.flow === "new-arrivals");
    const chips = Object.values(arrivals?.cells ?? {}).flat();

    // Step 2 is `route GET /api/products/new-arrivals`: it lands in the API column with its method and path.
    const route = chips.find((chip) => chip.type === "route");

    expect(route?.label).toBe("GET /api/products/new-arrivals");
    expect(route?.method).toBe("GET");
    expect(route?.path).toBe("/api/products/new-arrivals");
    expect(arrivals?.cells.api).toContain(route);
    expect(answer.map.columns.find((column) => column.id === "api")?.title).toBe("API");

    // Step 1 is `page /`: it lands in a column of an app, titled with the app's heading or id.
    const page = chips.find((chip) => chip.type === "page");

    expect(page?.step).toBe(1);
    expect(page?.app).toBeTruthy();
    expect(arrivals?.cells[`app:${page?.app}`]).toContain(page);

    // Columns come sorted: apps, then the API, then the background; none is empty.
    const order = ["site", "mobile", "api", "background", "other"];
    const ranks = answer.map.columns.map((column) => order.indexOf(column.type));

    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));

    for (const column of answer.map.columns) {
      expect(answer.map.rows.some((row) => (row.cells[column.id] ?? []).length > 0)).toBe(true);
    }

    expect(answer.fileGroups.flatMap((group) => group.files).sort()).toEqual(
      [...answer.bookmap.own].sort(),
    );
    expect(answer.proofs.map((item) => item.flow).sort()).toEqual(
      answer.flows.map((item) => item.id).sort(),
    );
  });

  it("caps direct imports at 50 and counts every one", async () => {
    const taken = await snapshot();
    const bookmap = taken.collected.flows["catalog/new-arrivals"];
    const step = bookmap?.steps[0];

    if (step === undefined) throw new Error("fixture flow has no step");

    step.direct = Array.from({ length: 80 }, (_, index) => `src/extra/f${index}.ts`);

    const compact = flowAnswer(taken, "catalog", "new-arrivals").bookmap.steps[0];

    expect(compact?.direct).toHaveLength(50);
    expect(compact?.counts.direct).toBe(80);
  });

  it("links neighbours in the README order", async () => {
    const taken = await snapshot();
    const flows = taken.written.features.find((item) => item.id === "catalog")?.flows ?? [];
    const first = flows[0]?.id.value ?? "";
    const answer = flowAnswer(taken, "catalog", first);

    expect(answer.previous).toBeNull();
    expect(flows.length > 1 ? answer.next : null).toEqual(flows.length > 1 ? answer.next : null);
  });

  it("pages a step's files by set, sorted, with module counts", async () => {
    const taken = await snapshot();
    const reachable = stepFiles(taken, "catalog", "new-arrivals", "1", { set: "reachable" });

    expect(reachable.total).toBeGreaterThan(0);
    expect(reachable.set).toBe("reachable");
    expect(reachable.modules.reduce((sum, item) => sum + item.count, 0)).toBe(reachable.total);

    const paged = stepFiles(taken, "catalog", "new-arrivals", "1", { limit: "1", offset: "1" });

    expect(paged.files).toHaveLength(Math.min(1, Math.max(0, reachable.total - 1)));
    expect(paged.limit).toBe(1);
    expect(stepFiles(taken, "catalog", "new-arrivals", "1", { limit: "9999" }).limit).toBe(200);
    expect(stepFiles(taken, "catalog", "new-arrivals", "1", { set: "type-only" }).total).toBe(0);
  });

  it("refuses a bad set, index or limit with 400 and an unknown flow or step with 404", async () => {
    const taken = await snapshot();
    const status = (run: () => unknown): number => {
      try {
        run();
      } catch (error) {
        return (error as { statusCode: number }).statusCode;
      }

      return 0;
    };

    expect(status(() => stepFiles(taken, "catalog", "new-arrivals", "1", { set: "all" }))).toBe(
      400,
    );
    expect(status(() => stepFiles(taken, "catalog", "new-arrivals", "x", {}))).toBe(400);
    expect(status(() => stepFiles(taken, "catalog", "new-arrivals", "1", { limit: "0" }))).toBe(
      400,
    );
    expect(status(() => stepFiles(taken, "catalog", "nope", "1", {}))).toBe(404);
    expect(status(() => stepFiles(taken, "catalog", "new-arrivals", "99", {}))).toBe(404);
  });

  it("filters and pages the check, and groups it by code with errors first", async () => {
    const taken = await snapshot();
    const all = checkPage(taken, {});
    const groups = checkGroups(taken);

    expect(all.total).toBe(all.findings.length);
    expect(checkPage(taken, { limit: 1 }).findings.length).toBeLessThanOrEqual(1);
    expect(checkPage(taken, { limit: 99_999 }).limit).toBe(500);
    expect(checkPage(taken, { code: "GR9999" }).total).toBe(0);

    const first = groups.groups[0];

    if (first !== undefined) {
      expect(checkPage(taken, { code: first.code }).total).toBe(first.count + first.expected);
    }

    const severities = groups.groups.map((group) => group.severity);

    expect(severities).toEqual(
      [...severities].sort((a, b) => (a === b ? 0 : a === "error" ? -1 : 1)),
    );
    expect(groups.counts).toEqual(all.counts);
  });
});

describe("steps without route facts", () => {
  it("counts a step as resolved only when found is true and reports unchecked steps apart", async () => {
    const { summary } = await import("./data");
    const { flowHealth } = await import("../scry/compact");
    copy = copyFixture();
    const snapshot = await openGrimoire(copy.root, createShopAdapter(), {
      routes: "fresh",
      write: false,
    });
    const flows = Object.fromEntries(
      Object.entries(snapshot.collected.flows).map(([ref, flow]) => [
        ref,
        {
          ...flow,
          steps: flow.steps.map((step, index) => ({
            ...step,
            found: index === 0 ? true : index === 1 ? false : null,
          })),
        },
      ]),
    );
    const changed = { ...snapshot, collected: { ...snapshot.collected, flows } } as typeof snapshot;
    const answer = summary(changed);
    const total = Object.values(flows).reduce((sum, flow) => sum + flow.steps.length, 0);

    expect(answer.steps.resolved + answer.steps.missing + answer.steps.unchecked).toBe(total);
    expect(answer.steps.checked).toBe(answer.steps.resolved + answer.steps.missing);

    const ref = Object.keys(flows)[0] ?? "";
    const steps = flows[ref]?.steps ?? [];
    const health = flowHealth({
      type: "flow",
      bookmap: flows[ref],
      findings: [],
    } as never);

    expect(health.steps.total).toBe(steps.filter((step) => step.found !== null).length);
    expect(health.steps.resolved).toBe(steps.filter((step) => step.found === true).length);
    expect(health.steps.unchecked).toBe(steps.filter((step) => step.found === null).length);
  });
});
