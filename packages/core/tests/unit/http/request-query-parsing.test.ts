import { describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * Bracket-notation parsing for `request.query` and `request.body`.
 *
 * Both go through the SAME `parseBody` (`request.ts` — `parsePayload` calls it
 * twice), so every case here is a claim about the body as much as the query.
 * That shared path is why these tests exist: the two defects below were found
 * from the QUERY side, and a careless fix would have changed how form posts and
 * uploads arrive.
 *
 * The grammar itself is not ours to choose — `@warlock.js/web`'s `href()` emits
 * what this parser accepts (`web` a70cdc9, measured in
 * `reports/query-grammar-findings-2026-08-24.md`). A change here that these
 * tests allow but that grammar forbids would put the page and the server back
 * into disagreement about the same URL, which is the failure they were written
 * to end.
 */
function parseQuery(query: Record<string, unknown>) {
  const request = new Request();

  request.baseRequest = { query, body: undefined, params: {} } as never;

  // `parsePayload` is protected; this test exercises it as the pipeline does.
  (request as unknown as { parsePayload(): void }).parsePayload();

  return request.query;
}

describe("Request — bracket-notation query parsing", () => {
  describe("nested objects", () => {
    it("reads a single level: filter[status]=active", () => {
      expect(parseQuery({ "filter[status]": "active" })).toEqual({
        filter: { status: "active" },
      });
    });

    /**
     * THE DEFECT: this used to answer `{ a: [] }`.
     *
     * `a[b][c]` contains "][", so it took the array-of-objects branch, which
     * computed `Number("b")` as NaN and wrote to `[NaN]` — a property on an
     * array whose length stays 0. The value was gone: no error, no warning, and
     * nothing in the response to suggest anything had happened.
     *
     * `@warlock.js/web` now refuses to EMIT this shape, so nothing Warlock
     * writes reaches it — but a hand-written URL, an external link or any API
     * client still can, which is why the parser has to be right rather than
     * merely unreachable from our own code.
     */
    it("reads two levels without losing the value: a[b][c]=x", () => {
      expect(parseQuery({ "a[b][c]": "x" })).toEqual({ a: { b: { c: "x" } } });
    });

    it("reads three levels: a[b][c][d]=x", () => {
      expect(parseQuery({ "a[b][c][d]": "x" })).toEqual({
        a: { b: { c: { d: "x" } } },
      });
    });

    it("keeps sibling keys at the same depth", () => {
      expect(
        parseQuery({ "filter[status]": "active", "filter[tier]": "gold" }),
      ).toEqual({ filter: { status: "active", tier: "gold" } });
    });
  });

  describe("arrays", () => {
    /**
     * THE SECOND DEFECT, and the one a real UI hits first.
     *
     * `tags[]` declares an array. But the underlying parser only hands us a JS
     * array when the caller sent the key MORE THAN ONCE, and the code only
     * wrapped when it was already an array — so the TYPE was decided by how
     * many times the key happened to appear. One selected filter chip gave a
     * string; a second one turned the same field into an array.
     */
    it("wraps a single occurrence: tags[]=a", () => {
      expect(parseQuery({ "tags[]": "a" })).toEqual({ tags: ["a"] });
    });

    it("keeps multiple occurrences: tags[]=a&tags[]=b", () => {
      expect(parseQuery({ "tags[]": ["a", "b"] })).toEqual({ tags: ["a", "b"] });
    });

    it("wraps a single occurrence when NESTED: filter[tags][]=a", () => {
      expect(parseQuery({ "filter[tags][]": "a" })).toEqual({
        filter: { tags: ["a"] },
      });
    });

    it("keeps multiple occurrences when nested: filter[tags][]=a&b", () => {
      expect(parseQuery({ "filter[tags][]": ["a", "b"] })).toEqual({
        filter: { tags: ["a", "b"] },
      });
    });
  });

  describe("numeric indices still build arrays of objects", () => {
    /**
     * The branch the NaN guard must NOT disturb. A numeric first segment is a
     * real array index and produces a real array — not an object with "0" as a
     * key, which is what a naive dotted-path fix would have given.
     */
    it("items[0][name] and items[1][name]", () => {
      const parsed = parseQuery({
        "items[0][name]": "first",
        "items[1][name]": "second",
      }) as { items: { name: string }[] };

      expect(Array.isArray(parsed.items)).toBe(true);
      expect(parsed.items).toEqual([{ name: "first" }, { name: "second" }]);
    });
  });

  describe("flat keys are untouched", () => {
    it("keeps a scalar a scalar", () => {
      expect(parseQuery({ q: "search" })).toEqual({ q: "search" });
    });

    /**
     * `?a=` is a key the caller SENT with an empty value — distinct from a key
     * they did not send. Collapsing the two is the kind of quiet repair that
     * makes a required field look absent.
     */
    it("keeps an empty value rather than dropping the key", () => {
      expect(parseQuery({ a: "" })).toEqual({ a: "" });
    });

    it("has no key at all when the caller sent none", () => {
      expect(parseQuery({})).toEqual({});
    });
  });
});
