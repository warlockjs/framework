import { afterEach, describe, expect, it } from "vitest";
import { bootHarness, type HttpHarness } from "./harness";

/**
 * A HAND-WRITTEN query string, over the real Fastify → router → `Request`
 * path, arriving at a controller.
 *
 * ## Why these exist beside the unit tests
 *
 * `tests/unit/http/request-query-parsing.test.ts` feeds `parseBody` directly.
 * That proves what `parseBody` does; it proves nothing about what reaches it.
 * **Fastify parses the query string into `baseRequest.query` before
 * `parseBody` is ever called** (`request.ts:520`), so every unit test we have
 * sits downstream of an unowned step. If Fastify's query parser is swapped or
 * configured, the shape changes upstream of all of them and nothing here fails.
 *
 * The open card these close claimed the bracket fix worked "for our own
 * emitter" but that "hand-written URLs still reach it". Reading the code says
 * that distinction does not exist — `parsePayload()` cannot know who wrote the
 * URL. Reading is not the standard: this executes it.
 */

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

/** Boot a route that answers with exactly what `request.query` parsed to. */
async function echoQuery() {
  return bootHarness((router) => {
    router.get("/echo", ({ request, response }) => {
      return response.success({ query: request.query });
    });
  });
}

describe("hand-written query strings — nested brackets", () => {
  it("keeps two levels: a[b][c]=x", async () => {
    harness = await echoQuery();

    const result = await harness.inject({ method: "GET", url: "/echo?a[b][c]=x" });

    // The defect this replaced: Number("b") → NaN → the value vanished into {a: []}.
    expect(harness.json(result).query).toEqual({ a: { b: { c: "x" } } });
  });

  it("keeps one level: filter[status]=active", async () => {
    harness = await echoQuery();

    const result = await harness.inject({ method: "GET", url: "/echo?filter[status]=active" });

    expect(harness.json(result).query).toEqual({ filter: { status: "active" } });
  });

  it("keeps sibling keys at the same depth", async () => {
    harness = await echoQuery();

    const result = await harness.inject({
      method: "GET",
      url: "/echo?filter[status]=active&filter[type]=book",
    });

    expect(harness.json(result).query).toEqual({ filter: { status: "active", type: "book" } });
  });
});

describe("hand-written query strings — array cardinality", () => {
  /*
    The shape must not depend on how many times the key was sent. A filter that
    is a string with one selection and an array with two changes type under the
    user's hands.
  */
  it("is an ARRAY at cardinality one: filter[tags][]=a", async () => {
    harness = await echoQuery();

    const result = await harness.inject({ method: "GET", url: "/echo?filter[tags][]=a" });

    expect(harness.json(result).query).toEqual({ filter: { tags: ["a"] } });
  });

  it("is the same array shape at cardinality two", async () => {
    harness = await echoQuery();

    const result = await harness.inject({
      method: "GET",
      url: "/echo?filter[tags][]=a&filter[tags][]=b",
    });

    expect(harness.json(result).query).toEqual({ filter: { tags: ["a", "b"] } });
  });
});

describe("hand-written query strings — a comma is a character, not a separator", () => {
  /*
    A standing refusal, not an oversight. Splitting values on "," to build
    arrays corrupts every legitimate comma — "Doe, John" becomes two people.
    If this test ever fails, someone re-added the comma-split "fix".
  */
  it("does not split a value containing a comma", async () => {
    harness = await echoQuery();

    const result = await harness.inject({
      method: "GET",
      url: `/echo?name=${encodeURIComponent("Doe, John")}`,
    });

    expect(harness.json(result).query).toEqual({ name: "Doe, John" });
  });

  it("does not split a comma inside a nested value either", async () => {
    harness = await echoQuery();

    const result = await harness.inject({
      method: "GET",
      url: `/echo?filter[name]=${encodeURIComponent("Doe, John")}`,
    });

    expect(harness.json(result).query).toEqual({ filter: { name: "Doe, John" } });
  });
});

describe("hand-written query strings — the empty case the release gate names", () => {
  /*
    "Every page's URL loads with an empty query string." A missing key must be
    absent, not an empty object or a null.
  */
  it("has no keys at all when none were sent", async () => {
    harness = await echoQuery();

    const result = await harness.inject({ method: "GET", url: "/echo" });

    expect(harness.json(result).query).toEqual({});
  });

  it("keeps a present-but-empty value rather than dropping the key", async () => {
    harness = await echoQuery();

    const result = await harness.inject({ method: "GET", url: "/echo?search=" });

    expect(harness.json(result).query).toEqual({ search: "" });
  });
});
