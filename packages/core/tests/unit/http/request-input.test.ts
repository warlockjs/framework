import { beforeEach, describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * The typed input accessors (`int`, `bool`, `string`, …) all read from the
 * already-parsed `payload` bag. In production `setRequest()` populates that bag
 * from the Fastify request; here we seed it directly so we can exercise the
 * accessor logic in isolation, with no Fastify server.
 *
 * NOTE: `parseValue()` (which trims strings and coerces "true"/"false"/"null")
 * runs during `parsePayload()`, NOT inside these accessors. Seeding `payload`
 * directly therefore bypasses that coercion — these tests assert what the
 * accessors do to ALREADY-parsed values.
 */
function makeRequest(all: Record<string, unknown>): Request {
  const request = new Request();

  (request as unknown as { payload: Record<string, unknown> }).payload = {
    all,
    body: {},
    query: {},
    params: {},
  };

  return request;
}

let request: Request;

beforeEach(() => {
  request = makeRequest({
    id: "42",
    zero: 0,
    name: "Sam",
    flagTrue: "true",
    flagFalse: "false",
    price: "9.99",
    count: "7",
    notNumeric: "abc",
    nested: { city: "Cairo" },
    email: "USER@Example.COM",
  });
});

describe("Request — input()/get()/has()", () => {
  it("reads a top-level value", () => {
    expect(request.input("name")).toBe("Sam");
  });

  it("reads a dot-notation nested value", () => {
    expect(request.input("nested.city")).toBe("Cairo");
  });

  it("falls back to the default when the key is absent", () => {
    expect(request.input("missing", "fallback")).toBe("fallback");
  });

  it("get() is an alias for input()", () => {
    expect(request.get("name")).toBe(request.input("name"));
  });

  it("has() is true for present keys and false for absent ones", () => {
    expect(request.has("name")).toBe(true);
    expect(request.has("missing")).toBe(false);
  });

  it("has() is true for a present falsy value", () => {
    expect(request.has("zero")).toBe(true);
  });
});

describe("Request — int()", () => {
  it("parses a numeric string", () => {
    expect(request.int("count")).toBe(7);
  });

  it("returns 0 for a present zero", () => {
    expect(request.int("zero")).toBe(0);
  });

  it("returns the default (0) for an absent key", () => {
    // `int()` defaults to 0, and `parseInt(0)` is 0 — not undefined.
    expect(request.int("missing")).toBe(0);
  });

  it("returns undefined when the resolved value is falsy and not zero", () => {
    // Passing an empty-string default makes the value falsy-but-not-zero,
    // which is the only path that yields undefined.
    expect(request.int("missing", "" as unknown as number)).toBeUndefined();
  });
});

describe("Request — bool()", () => {
  it("maps the string 'true' to true", () => {
    expect(request.bool("flagTrue")).toBe(true);
  });

  it("maps the string 'false' to false", () => {
    expect(request.bool("flagFalse")).toBe(false);
  });

  it("treats numeric 0 as false", () => {
    expect(request.bool("zero")).toBe(false);
  });

  it("defaults to false for an absent key", () => {
    expect(request.bool("missing")).toBe(false);
  });
});

describe("Request — string()/number()/float()", () => {
  it("string() stringifies the value", () => {
    expect(request.string("count")).toBe("7");
  });

  it("number() parses a numeric string", () => {
    expect(request.number("price")).toBe(9.99);
  });

  it("number() returns the default for a non-numeric value", () => {
    expect(request.number("notNumeric", 5)).toBe(5);
  });

  it("float() parses a float", () => {
    expect(request.float("price")).toBe(9.99);
  });

  it("float() returns 0 for a non-numeric value", () => {
    expect(request.float("notNumeric")).toBe(0);
  });
});

describe("Request — email()", () => {
  it("lowercases the email value", () => {
    expect(request.email()).toBe("user@example.com");
  });

  it("returns the default when absent", () => {
    const bare = makeRequest({});

    expect(bare.email("email", "none@x.com")).toBe("none@x.com");
  });
});

describe("Request — only()/except()/pluck()", () => {
  it("only() narrows to the requested keys", () => {
    expect(request.only(["id", "name"])).toEqual({ id: "42", name: "Sam" });
  });

  it("except() drops the requested keys", () => {
    const result = request.except(["id", "zero", "flagTrue", "flagFalse", "price", "count", "notNumeric", "nested", "email"]);

    expect(result).toEqual({ name: "Sam" });
  });

  it("pluck() returns the keys and removes them from the bag", () => {
    const plucked = request.pluck(["name"]);

    expect(plucked).toEqual({ name: "Sam" });
    expect(request.has("name")).toBe(false);
  });
});

describe("Request — set()/setDefault()/unset()", () => {
  it("set() writes a value", () => {
    request.set("added", "value");

    expect(request.input("added")).toBe("value");
  });

  it("setDefault() only writes when the key is absent", () => {
    request.setDefault("name", "Override");
    request.setDefault("brandNew", "Created");

    expect(request.input("name")).toBe("Sam");
    expect(request.input("brandNew")).toBe("Created");
  });

  it("unset() removes keys", () => {
    request.unset("name", "id");

    expect(request.has("name")).toBe(false);
    expect(request.has("id")).toBe(false);
  });
});

describe("Request — heavy()", () => {
  it("drops empty values but keeps null and falsy-but-present zero", () => {
    const heavyRequest = makeRequest({
      keep: "value",
      keepZero: 0,
      keepNull: null,
      dropEmptyString: "",
      dropEmptyArray: [],
    });

    expect(heavyRequest.heavy()).toEqual({
      keep: "value",
      keepZero: 0,
      keepNull: null,
    });
  });
});

describe("Request — allExceptParams()", () => {
  it("merges query and body but excludes params", () => {
    const request = new Request();

    (request as unknown as { payload: Record<string, unknown> }).payload = {
      all: {},
      body: { title: "Hello" },
      query: { page: "2" },
      params: { id: "5" },
    };

    expect(request.allExceptParams()).toEqual({ title: "Hello", page: "2" });
  });
});
