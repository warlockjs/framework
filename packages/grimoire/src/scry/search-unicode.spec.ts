import { describe, expect, it } from "vitest";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { scry } from "./query";
import { wordsOf } from "./search";

const located = <T>(value: T) => ({ value, at: { file: "x", line: 1 } });

function snapshotOf(
  features: {
    id: string;
    title: string;
    flows?: { id: string; heading: string; criteria?: string[] }[];
  }[],
  files: { file: string; about?: string | null }[] = [],
): GrimoireSnapshot {
  return {
    root: "/p",
    routes: "fresh",
    written: {
      apps: [],
      features: features.map((feature) => ({
        id: feature.id,
        readme: { title: located(feature.title), summary: null, why: null, audience: [] },
        flows: (feature.flows ?? []).map((item) => ({
          id: located(item.id),
          ref: `${feature.id}/${item.id}`,
          heading: located(item.heading),
          summary: null,
          who: located("customer"),
          story: [],
          cases: [],
          criteria: (item.criteria ?? []).map((text, index) => ({ id: `AC-${index + 1}`, text })),
        })),
      })),
    },
    book: {
      facts: {
        pages: [],
        mobile: [],
        routes: [],
        named: [],
        files: files.map((file) => ({ about: null, exports: [], ...file })),
      },
    },
    apps: {},
    collected: { tasksIndex: { open: [], done: [] } },
  } as unknown as GrimoireSnapshot;
}

const ids = (snapshot: GrimoireSnapshot, text: string): string[] => {
  const result = scry(snapshot, { type: "search", text });

  if (result.type !== "search") throw new Error("expected a search answer");

  return result.hits.map((hit) => hit.id);
};

describe("one tokeniser for the query and the index", () => {
  it("folds accents, Arabic marks, tatweel, alef, ya and ta marbuta", () => {
    expect(wordsOf("Café")).toEqual(["cafe"]);
    expect(wordsOf("cafe")).toEqual(["cafe"]);
    expect(wordsOf("الشحنة")).toEqual(["شحنه"]);
    expect(wordsOf("شحنة")).toEqual(["شحنه"]);
    expect(wordsOf("أحمد إحسان")).toEqual(wordsOf("احمد احسان"));
    expect(wordsOf("مُحَمَّد")).toEqual(wordsOf("محمد"));
    expect(wordsOf("شحـــنة")).toEqual(wordsOf("شحنة"));
    expect(wordsOf("مستشفى")).toEqual(wordsOf("مستشفي"));
  });

  it("keeps ids as one word and splits camel case of any script", () => {
    expect(wordsOf("AC-5")).toEqual(["ac5"]);
    expect(wordsOf("newArrivals")).toEqual(["new", "arrivals"]);
    expect(wordsOf("éclairÉtoile")).toEqual(["eclair", "etoile"]);
  });

  it("strips the article only from words of five letters or more", () => {
    expect(wordsOf("الشحن")).toEqual(["شحن"]);
    expect(wordsOf("الله")).toEqual(["الله"]);
    expect(wordsOf("والشحن")).toEqual(["شحن"]);
    expect(wordsOf("للعملاء")).toEqual(["عملاء"]);
  });
});

describe("scry search over Arabic and accented text", () => {
  const snapshot = snapshotOf(
    [
      {
        id: "shipping",
        title: "الشحنة",
        flows: [
          {
            id: "track",
            heading: "تتبع الطلب",
            criteria: ["يرى العميل حالة الشحنة في الصفحة"],
          },
        ],
      },
      { id: "menu", title: "Café menu" },
    ],
    [{ file: "src/app/shipping/shipment.ts", about: "Creates a shipment." }],
  );

  it("answers an Arabic query on an Arabic feature title first", () => {
    expect(ids(snapshot, "شحنة")[0]).toBe("shipping");
    expect(ids(snapshot, "الشحنة")[0]).toBe("shipping");
  });

  it("finds a flow by the Arabic text of a criterion", () => {
    expect(ids(snapshot, "حالة الشحنه")).toContain("shipping/track");
    expect(ids(snapshot, "إلى حالة")).toContain("shipping/track");
  });

  it("matches accented Latin both ways", () => {
    expect(ids(snapshot, "cafe")).toContain("menu");
    expect(ids(snapshot, "café")).toContain("menu");
  });

  it("no longer raises GR9006 for an Arabic-only query", () => {
    expect(() => ids(snapshot, "العملاء")).not.toThrow();
    expect(() => scry(snapshot, { type: "search", text: "؟؟ !!" })).toThrow(/no letters or digits/);
  });

  it("a query of Arabic stop words matches nothing", () => {
    expect(ids(snapshot, "في من")).toEqual([]);
  });
});
