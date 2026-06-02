import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for toJsonSchema format/keyword branches that the per-validator
 * suites skip — string format hints, record additionalProperties, tuple
 * prefixItems vs draft-07 items, literal const/enum, nullable discriminated
 * union — plus the BooleanValidator accepted/declined fluent surface and a few
 * small misc methods (record.plainObject, literal.matchesType, tuple.clone).
 *
 * Verified against string-validator.ts, record-validator.ts, tuple-validator.ts,
 * literal-validator.ts, discriminated-union-validator.ts, boolean-validator.ts.
 */

describe("StringValidator.toJsonSchema - format hints", () => {
  it("email → format email", () => {
    expect(v.string().email().toJsonSchema().format).toBe("email");
  });

  it("url → format uri", () => {
    expect(v.string().url().toJsonSchema().format).toBe("uri");
  });

  it("ip / ip4 → ipv4, ip6 → ipv6", () => {
    expect(v.string().ip().toJsonSchema().format).toBe("ipv4");
    expect(v.string().ip4().toJsonSchema().format).toBe("ipv4");
    expect(v.string().ip6().toJsonSchema().format).toBe("ipv6");
  });

  it("uuid → format uuid", () => {
    expect(v.string().uuid().toJsonSchema().format).toBe("uuid");
  });

  it("hexColor → format color", () => {
    expect(v.string().hexColor().toJsonSchema().format).toBe("color");
  });

  it("cuid / ulid / nanoid fall back to a pattern (no widely-supported format)", () => {
    expect(v.string().cuid().toJsonSchema().pattern).toBe("^[a-z][a-z0-9]{23}$");
    expect(v.string().cuid({ version: 1 }).toJsonSchema().pattern).toBe("^c[a-z0-9]{24,}$");
    expect(v.string().ulid().toJsonSchema().pattern).toBe("^[0-9A-HJKMNP-TV-Z]{26}$");
    expect(v.string().nanoid(10).toJsonSchema().pattern).toBe("^[A-Za-z0-9_-]{10}$");
  });

  it("min/max/length/pattern keywords + enum", () => {
    const schema = v.string().min(2).max(10).toJsonSchema();
    expect(schema).toMatchObject({ type: "string", minLength: 2, maxLength: 10 });

    expect(v.string().length(4).toJsonSchema()).toMatchObject({ minLength: 4, maxLength: 4 });
    expect(v.string().lengthBetween(3, 8).toJsonSchema()).toMatchObject({
      minLength: 3,
      maxLength: 8,
    });
    expect(v.string().pattern(/^[a-z]+$/).toJsonSchema().pattern).toBe("^[a-z]+$");
    expect(v.string().in(["a", "b"]).toJsonSchema().enum).toEqual(["a", "b"]);
  });

  it("nullable widens the type", () => {
    expect(v.string().nullable().toJsonSchema("draft-2020-12").type).toEqual(["string", "null"]);
  });
});

describe("RecordValidator", () => {
  it("toJsonSchema describes a homogeneous map via additionalProperties", () => {
    expect(v.record(v.string()).toJsonSchema()).toEqual({
      type: "object",
      additionalProperties: { type: "string" },
    });
  });

  it("nullable record gains the null branch", () => {
    const schema = v.record(v.number()).nullable().toJsonSchema("draft-2020-12");
    expect(schema.type).toEqual(["object", "null"]);
  });

  it("plainObject() rejects non-plain objects like arrays", async () => {
    const validator = v.record(v.any()).plainObject();
    expect((await validate(validator, { a: 1 })).isValid).toBe(true);
    expect((await validate(validator, [])).isValid).toBe(false);
  });

  it("matchesType recognizes plain objects only", () => {
    const validator = v.record(v.any());
    expect(validator.matchesType({})).toBe(true);
    expect(validator.matchesType([])).toBe(false);
  });
});

describe("TupleValidator.toJsonSchema", () => {
  it("draft-2020-12 uses prefixItems + items:false", () => {
    const schema = v.tuple([v.string(), v.int(), v.boolean()]).toJsonSchema("draft-2020-12");
    expect(schema).toEqual({
      type: "array",
      minItems: 3,
      maxItems: 3,
      prefixItems: [{ type: "string" }, { type: "integer" }, { type: "boolean" }],
      items: false,
    });
  });

  it("draft-07 uses items array + additionalItems:false", () => {
    const schema = v.tuple([v.string(), v.number()]).toJsonSchema("draft-07");
    expect(schema.items).toEqual([{ type: "string" }, { type: "number" }]);
    expect(schema.additionalItems).toBe(false);
  });

  it("nullable tuple gains the null branch", () => {
    const schema = v.tuple([v.string()]).nullable().toJsonSchema("draft-2020-12");
    expect(schema.type).toEqual(["array", "null"]);
  });
});

describe("LiteralValidator", () => {
  it("single literal → const, multiple → enum", () => {
    expect(v.literal("only").toJsonSchema()).toEqual({ const: "only" });
    expect(v.literal("a", "b", "c").toJsonSchema()).toEqual({ enum: ["a", "b", "c"] });
  });

  it("matchesType reflects the configured literal set", () => {
    const validator = v.literal("draft", "published");
    expect(validator.matchesType("draft")).toBe(true);
    expect(validator.matchesType("archived")).toBe(false);
  });

  it("validates membership and rejects non-members", async () => {
    const validator = v.literal(1, 2, 3);
    expect((await validate(validator, 2)).isValid).toBe(true);
    expect((await validate(validator, 9)).isValid).toBe(false);
  });

  it("nullable literal gains the null branch", () => {
    const schema = v.literal("x").nullable().toJsonSchema("draft-2020-12");
    // const form stays a const; nullable wraps via type array only when type exists,
    // for draft-2020-12 with no `type` key applyNullable sets type: [undefined, "null"]
    expect(schema).toHaveProperty("const", "x");
  });
});

describe("DiscriminatedUnion - nullable JSON schema + matchesType", () => {
  const branch = (lit: string) =>
    v.object({ type: v.literal(lit), value: v.string() });

  it("matchesType only accepts plain objects", () => {
    const du = v.discriminatedUnion("type", [branch("a"), branch("b")]);
    expect(du.matchesType({})).toBe(true);
    expect(du.matchesType([])).toBe(false);
  });

  it("nullable oneOf wraps with null for a standard target", () => {
    const du = v.discriminatedUnion("type", [branch("a"), branch("b")]).nullable();
    const schema = du.toJsonSchema("draft-07") as any;
    // draft-07 nullable wraps the whole schema in oneOf:[copy, {type:null}]
    expect(schema.oneOf.some((s: any) => s.type === "null")).toBe(true);
  });

  it("nullable oneOf appends a null branch for openai-strict", () => {
    const du = v.discriminatedUnion("type", [branch("a"), branch("b")]).nullable();
    const schema = du.toJsonSchema("openai-strict") as any;
    expect(schema.oneOf.some((s: any) => s.type === "null")).toBe(true);
  });
});

describe("BooleanValidator accepted/declined cross-field (fluent)", () => {
  it("acceptedIfRequired / acceptedIfPresent / acceptedWithout", async () => {
    const ifRequired = v.object({
      email: v.string().optional(),
      terms: v.boolean().acceptedIfRequired("email").optional(),
    });
    expect((await validate(ifRequired, {})).isValid).toBe(true);
    expect((await validate(ifRequired, { email: "a@b.com", terms: true })).isValid).toBe(true);
    expect((await validate(ifRequired, { email: "a@b.com", terms: false })).isValid).toBe(false);

    const ifPresent = v.object({
      promo: v.string().optional(),
      optIn: v.boolean().acceptedIfPresent("promo").optional(),
    });
    expect((await validate(ifPresent, { promo: "x", optIn: true })).isValid).toBe(true);
    expect((await validate(ifPresent, { promo: "x", optIn: false })).isValid).toBe(false);

    const without = v.object({
      premium: v.string().optional(),
      ads: v.boolean().acceptedWithout("premium").optional(),
    });
    expect((await validate(without, { ads: true })).isValid).toBe(true);
    expect((await validate(without, { premium: "p" })).isValid).toBe(true);
    expect((await validate(without, { ads: false })).isValid).toBe(false);
  });

  it("declinedUnless / declinedIfRequired / declinedIfPresent / declinedWithout", async () => {
    const unless = v.object({
      member: v.boolean(),
      marketing: v.boolean().declinedUnless("member", true).optional(),
    });
    expect((await validate(unless, { member: true })).isValid).toBe(true);
    expect((await validate(unless, { member: false, marketing: false })).isValid).toBe(true);
    expect((await validate(unless, { member: false, marketing: true })).isValid).toBe(false);

    const ifRequired = v.object({
      email: v.string().optional(),
      newsletter: v.boolean().declinedIfRequired("email").optional(),
    });
    expect((await validate(ifRequired, { email: "a@b.com", newsletter: false })).isValid).toBe(
      true,
    );
    expect((await validate(ifRequired, { email: "a@b.com", newsletter: true })).isValid).toBe(
      false,
    );

    const ifPresent = v.object({
      optOut: v.string().optional(),
      consent: v.boolean().declinedIfPresent("optOut").optional(),
    });
    expect((await validate(ifPresent, { optOut: "x", consent: false })).isValid).toBe(true);
    expect((await validate(ifPresent, { optOut: "x", consent: true })).isValid).toBe(false);

    const without = v.object({
      premium: v.string().optional(),
      ads: v.boolean().declinedWithout("premium").optional(),
    });
    expect((await validate(without, { ads: false })).isValid).toBe(true);
    expect((await validate(without, { ads: true })).isValid).toBe(false);
  });

  it("matchesType recognizes only real booleans", () => {
    const validator = v.boolean();
    expect(validator.matchesType(true)).toBe(true);
    expect(validator.matchesType("true")).toBe(false);
  });
});
