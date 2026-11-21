import { describe, expect, it } from "vitest";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { formatScryResult } from "./format";
import { scry } from "./query";
import { SCRY_STOP_WORDS } from "./search";

const located = <T>(value: T) => ({ value, at: { file: "x", line: 1 } });

type FileFixture = { file: string; about?: string | null; exports?: string[]; mobileApp?: string };

type Fixture = {
  flows?: { id: string; heading: string; summary?: string }[];
  files?: FileFixture[];
  blocks?: { app: string; page: string; block: string; flow?: string }[];
  pages?: { file: string; route: string }[];
  mobileRoot?: string;
};

function snapshotOf(fixture: Fixture): GrimoireSnapshot {
  const apps = [...new Set((fixture.blocks ?? []).map((row) => row.app))].map((app) => ({
    id: located(app),
    layouts: [],
    screens: [],
    pages: [
      ...new Set((fixture.blocks ?? []).filter((row) => row.app === app).map((r) => r.page)),
    ].map((page) => ({
      id: page,
      blocks: (fixture.blocks ?? [])
        .filter((row) => row.app === app && row.page === page)
        .map((row) => ({ block: row.block, flow: row.flow ?? null })),
    })),
  }));

  return {
    root: "/p",
    routes: "fresh",
    written: {
      apps,
      features: [
        {
          id: "billing",
          readme: { title: located("Billing"), summary: null, why: null, audience: [] },
          flows: (fixture.flows ?? []).map((item) => ({
            id: located(item.id),
            ref: `billing/${item.id}`,
            heading: located(item.heading),
            summary: item.summary ?? null,
            who: located("customer"),
            story: [],
            cases: [],
            criteria: [],
          })),
        },
      ],
    },
    book: {
      facts: {
        pages: (fixture.pages ?? []).map((page) => ({ site: "web", ...page })),
        mobile: [],
        routes: [],
        named: [],
        files: (fixture.files ?? []).map((item) => ({
          file: item.file,
          about: item.about ?? null,
          exports: (item.exports ?? []).map((name) => ({ name, about: null })),
          mobileApp: item.mobileApp ?? null,
        })),
      },
    },
    apps: fixture.mobileRoot
      ? {
          mobile: {
            app: "mobile",
            type: "mobile",
            site: null,
            mobile: { id: "mobile", root: fixture.mobileRoot },
          },
        }
      : {},
    collected: { tasksIndex: { open: [], done: [] } },
  } as unknown as GrimoireSnapshot;
}

const search = (snapshot: GrimoireSnapshot, text: string, extra: { app?: string } = {}) => {
  const result = scry(snapshot, { type: "search", text, ...extra });

  if (result.type !== "search") throw new Error("expected a search answer");

  return result;
};

describe("scry search ranking", () => {
  it("finds the file of a whole sentence", () => {
    const snapshot = snapshotOf({
      files: [
        { file: "src/build/build-plan.ts", about: "Builds the plan." },
        { file: "src/ui/ui-kit.ts" },
        { file: "mobile/src/app/settings.tsx" },
        { file: "mobile/src/app/change-history.tsx" },
        { file: "src/history/clean.service.ts" },
      ],
    });
    const hits = search(snapshot, "the change history screen needs a better ui").hits;

    expect(hits[0]?.id).toBe("mobile/src/app/change-history.tsx");
  });

  it("ranks a flow by its exact title first, even when files share its words", () => {
    const snapshot = snapshotOf({
      flows: [
        { id: "start", heading: "Start a trial" },
        { id: "other", heading: "Pay an invoice", summary: "Start a trial of the invoice" },
      ],
      files: [
        { file: "src/trial/start-a-trial.ts", about: "Start a trial for a customer." },
        { file: "src/trial/start.ts" },
      ],
    });
    const hits = search(snapshot, "Start a trial").hits;

    expect(hits[0]?.id).toBe("billing/start");
    expect(hits[0]?.type).toBe("flow");
  });

  it("matches whole words only: ui does not match build", () => {
    const snapshot = snapshotOf({
      files: [{ file: "src/build.ts", about: "Build the bundle." }, { file: "src/ui/panel.ts" }],
    });

    expect(search(snapshot, "ui").hits.map((hit) => hit.id)).toEqual(["src/ui/panel.ts"]);
  });

  it("does not match a long block text through its id", () => {
    const snapshot = snapshotOf({
      blocks: [
        {
          app: "web",
          page: "home",
          block: "Choose your plan and pay the invoice for the yearly subscription renewal",
        },
      ],
    });

    expect(search(snapshot, "the mobile settings screen needs a layout").hits).toEqual([]);

    const hit = search(snapshot, "web home").hits[0];

    expect(hit?.type).toBe("block");
    expect(hit?.app).toBe("web");
  });

  it("prints a higher-scored file above a lower-scored block", () => {
    const snapshot = snapshotOf({
      blocks: [{ app: "web", page: "home", block: "Shows the invoice list" }],
      files: [{ file: "src/invoice/invoice-list.service.ts", about: "Lists the invoice list." }],
    });
    const result = search(snapshot, "invoice list service");
    const types = result.hits.map((hit) => hit.type);

    expect(types.indexOf("file")).toBeLessThan(types.indexOf("block"));
    expect(result.hits[0]?.score).toBeGreaterThan(result.hits[1]?.score ?? 0);

    const text = formatScryResult(result).join("\n");

    expect(text).toMatch(/^\s*\d+\.\d {2}file/m);
  });

  it("keeps the hits of one app with --app", () => {
    const snapshot = snapshotOf({
      mobileRoot: "mobile",
      files: [{ file: "mobile/src/cart.ts" }, { file: "src/cart.ts" }],
      blocks: [{ app: "web", page: "cart", block: "Cart total" }],
    });
    const all = search(snapshot, "cart").hits;
    const mobile = search(snapshot, "cart", { app: "mobile" }).hits;

    expect(all.length).toBeGreaterThan(1);
    expect(mobile.map((hit) => hit.id)).toEqual(["mobile/src/cart.ts"]);
    expect(mobile[0]?.app).toBe("mobile");
  });

  it("returns nothing for stop words alone", () => {
    const snapshot = snapshotOf({ files: [{ file: "src/the/of.ts", about: "The and of." }] });

    expect(search(snapshot, "the of and").hits).toEqual([]);
  });

  it("keeps ids such as WL9003 and AC-5 whole", () => {
    const snapshot = snapshotOf({
      files: [
        { file: "src/errors.ts", about: "Raises WL9003 when a file is missing." },
        { file: "src/ac.ts", about: "Checks AC-5." },
      ],
    });

    expect(search(snapshot, "WL9003 missing").hits[0]?.id).toBe("src/errors.ts");
    expect(search(snapshot, "WL9").hits).toEqual([]);
    expect(search(snapshot, "AC-6").hits).toEqual([]);
    expect(search(snapshot, "ac-5").hits[0]?.id).toBe("src/ac.ts");
  });

  it("puts a page file before its helper files on an equal score", () => {
    const snapshot = snapshotOf({
      files: [{ file: "src/home/x.tsx" }, { file: "src/home/y.tsx" }],
      pages: [{ file: "src/home/y.tsx", route: "/" }],
    });
    const ids = search(snapshot, "home")
      .hits.filter((hit) => hit.type === "file")
      .map((h) => h.id);

    expect(ids).toEqual(["src/home/y.tsx", "src/home/x.tsx"]);
  });

  it("stems words and lets the stop list be extended", () => {
    const snapshot = snapshotOf({
      files: [{ file: "src/pay.ts", about: "Retries failed payments." }],
    });

    expect(search(snapshot, "a failing payment").hits[0]?.id).toBe("src/pay.ts");
    expect(SCRY_STOP_WORDS.has("the")).toBe(true);
  });

  it("answers repeated queries of one snapshot the same", () => {
    const snapshot = snapshotOf({ files: [{ file: "src/a/cart.ts" }] });

    expect(search(snapshot, "cart")).toEqual(search(snapshot, "cart"));
  });
});
