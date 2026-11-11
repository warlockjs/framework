import { describe, expect, it, vi } from "vitest";
import { similarWithin } from "./similar-within";

type Hit = { key: string; scope: string };

/** A store holding `hits` in rank order; returns the first `topK`. */
function storeOf(hits: Hit[]) {
  return vi.fn(async (topK: number) => hits.slice(0, topK));
}

describe("similarWithin", () => {
  it("issues exactly one query when the first page holds enough in-scope hits", async () => {
    const query = storeOf([
      { key: "a1", scope: "a" },
      { key: "a2", scope: "a" },
      { key: "b1", scope: "b" },
    ]);

    const hits = await similarWithin(query, (hit) => hit.scope === "a", { topK: 3, want: 2 });

    expect(hits.map((hit) => hit.key)).toEqual(["a1", "a2"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(3);
  });

  it("widens the page when other scopes crowd the top of the ranking", async () => {
    const crowd = Array.from({ length: 200 }, (_, index) => ({ key: `b${index}`, scope: "b" }));
    const query = storeOf([...crowd, { key: "a1", scope: "a" }, { key: "a2", scope: "a" }]);

    const hits = await similarWithin(query, (hit) => hit.scope === "a", { topK: 5, want: 2 });

    expect(hits.map((hit) => hit.key)).toEqual(["a1", "a2"]);
    expect(query.mock.calls.map(([topK]) => topK)).toEqual([5, 20, 80, 320]);
  });

  it("stops when the store has nothing more to give", async () => {
    const query = storeOf([{ key: "b1", scope: "b" }]);

    const hits = await similarWithin(query, (hit) => hit.scope === "a", { topK: 5, want: 1 });

    expect(hits).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("never asks for more than maxTopK", async () => {
    const crowd = Array.from({ length: 100 }, (_, index) => ({ key: `b${index}`, scope: "b" }));
    const query = storeOf(crowd);

    await similarWithin(query, (hit) => hit.scope === "a", { topK: 4, want: 1, maxTopK: 30 });

    expect(query.mock.calls.map(([topK]) => topK)).toEqual([4, 16, 30]);
  });
});
