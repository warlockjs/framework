import { describe, expect, it } from "vitest";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { scry } from "./query";

const located = <T>(value: T) => ({ value, at: { file: "x", line: 1 } });

function flow(id: string, heading: string, extra: Record<string, unknown> = {}) {
  return {
    id: located(id),
    ref: `billing/${id}`,
    heading: located(heading),
    summary: null,
    who: located("customer"),
    story: [],
    cases: [],
    criteria: [],
    ...extra,
  };
}

function snapshotOf(flows: unknown[], files: string[]): GrimoireSnapshot {
  return {
    root: "/p",
    routes: "fresh",
    written: {
      apps: [],
      features: [
        {
          id: "billing",
          readme: { title: located("Billing"), summary: null, why: null, audience: [] },
          flows,
        },
      ],
    },
    book: {
      facts: {
        pages: [],
        mobile: [],
        routes: [],
        named: [],
        files: files.map((file) => ({ file, about: null, exports: [] })),
      },
    },
    apps: {},
    collected: { tasksIndex: { open: [], done: [] } },
  } as unknown as GrimoireSnapshot;
}

const search = (snapshot: GrimoireSnapshot, text: string, limit?: number) => {
  const result = scry(snapshot, {
    type: "search",
    text,
    ...(limit === undefined ? {} : { limit }),
  });

  if (result.type !== "search") throw new Error("expected a search answer");

  return result;
};

describe("scry search over written content", () => {
  it("keeps a flow inside the limit when many files carry the word", () => {
    const files = Array.from({ length: 30 }, (_, index) => `src/trial/trial-${index}.service.ts`);
    const snapshot = snapshotOf([flow("start", "Start a trial")], files);
    const result = search(snapshot, "trial");

    expect(result.hits).toHaveLength(20);
    expect(result.hits.some((hit) => hit.type === "flow" && hit.id === "billing/start")).toBe(true);
    expect(result.counts.file).toBe(30);
  });

  it("groups results by type with written content first", () => {
    const snapshot = snapshotOf([flow("start", "Start a trial")], ["src/trial.ts"]);
    const types = search(snapshot, "trial").hits.map((hit) => hit.type);

    expect(types.indexOf("flow")).toBeLessThan(types.indexOf("file"));
  });

  it("finds a flow by a word of its title", () => {
    const snapshot = snapshotOf([flow("cancel", "Cancel, resume or switch")], []);

    expect(search(snapshot, "resume").hits.map((hit) => hit.id)).toContain("billing/cancel");
  });

  it("finds a flow by its summary, story, case text and criterion id", () => {
    const snapshot = snapshotOf(
      [
        flow("pay", "Pay", {
          summary: "A customer pays the invoice",
          story: [{ index: 1, text: "The customer sees a double charge warning" }],
          cases: [
            { question: "duplicate", answer: "payment failed twice is retried", criteria: [] },
          ],
          criteria: [{ id: "AC-5", text: "A receipt is emailed" }],
        }),
      ],
      [],
    );

    for (const text of ["invoice", "double charge", "payment failed", "AC-5", "receipt"]) {
      expect(search(snapshot, text).hits.map((hit) => hit.id)).toContain("billing/pay");
    }

    const hit = search(snapshot, "AC-5").hits.find((item) => item.id === "billing/pay");

    expect(hit?.matched).toContain("AC-5");
    expect(search(snapshot, "AC-6").hits).toHaveLength(0);
  });

  it("ranks a flow above a file for the same name match", () => {
    const snapshot = snapshotOf([flow("trial", "Trial")], ["src/trial.ts"]);
    const hits = search(snapshot, "trial").hits;

    expect(hits.findIndex((hit) => hit.type === "flow")).toBeLessThan(
      hits.findIndex((hit) => hit.type === "file"),
    );
  });
});
