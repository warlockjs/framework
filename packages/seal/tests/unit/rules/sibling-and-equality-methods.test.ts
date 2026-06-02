import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for the *Sibling scope variants of the conditional methods (which
 * only differ from their global forms by passing scope:"sibling"), the equality
 * methods (sameAs / sameAsSibling / differentFrom / differentFromSibling), and
 * the when / whenSibling conditional-schema methods, plus the remaining date
 * mutators (addHours / toStartOfYear / toEndOfYear / toUTC).
 *
 * Verified against required-methods.ts, present-methods.ts, forbidden-methods.ts,
 * equality-conditional-methods.ts and date-mutators.ts.
 */

describe("required* sibling variants", () => {
  it("requiredWithSibling / requiredWithoutSibling", async () => {
    const withV = v.object({
      g: v.object({
        type: v.string().optional(),
        subType: v.string().requiredWithSibling("type"),
      }),
    });
    expect((await validate(withV, { g: {} })).isValid).toBe(true);
    expect((await validate(withV, { g: { type: "A", subType: "B" } })).isValid).toBe(true);
    expect((await validate(withV, { g: { type: "A" } })).isValid).toBe(false);

    const withoutV = v.object({
      g: v.object({
        email: v.string().optional(),
        phone: v.string().requiredWithoutSibling("email"),
      }),
    });
    expect((await validate(withoutV, { g: { email: "e" } })).isValid).toBe(true);
    expect((await validate(withoutV, { g: { phone: "p" } })).isValid).toBe(true);
    expect((await validate(withoutV, { g: {} })).isValid).toBe(false);
  });

  it("requiredIfSibling / requiredUnlessSibling", async () => {
    const ifV = v.object({
      g: v.object({
        role: v.string(),
        level: v.number().requiredIfSibling("role", "admin"),
      }),
    });
    expect((await validate(ifV, { g: { role: "user" } })).isValid).toBe(true);
    expect((await validate(ifV, { g: { role: "admin", level: 1 } })).isValid).toBe(true);
    expect((await validate(ifV, { g: { role: "admin" } })).isValid).toBe(false);

    const unlessV = v.object({
      g: v.object({
        guest: v.boolean(),
        name: v.string().requiredUnlessSibling("guest", true),
      }),
    });
    expect((await validate(unlessV, { g: { guest: true } })).isValid).toBe(true);
    expect((await validate(unlessV, { g: { guest: false } })).isValid).toBe(false);
  });

  it("requiredIfInSibling / requiredIfNotInSibling", async () => {
    const inV = v.object({
      g: v.object({
        tier: v.string(),
        code: v.string().requiredIfInSibling("tier", ["gold", "platinum"]),
      }),
    });
    expect((await validate(inV, { g: { tier: "silver" } })).isValid).toBe(true);
    expect((await validate(inV, { g: { tier: "gold" } })).isValid).toBe(false);

    const notInV = v.object({
      g: v.object({
        country: v.string(),
        vat: v.string().requiredIfNotInSibling("country", ["US", "CA"]),
      }),
    });
    expect((await validate(notInV, { g: { country: "US" } })).isValid).toBe(true);
    expect((await validate(notInV, { g: { country: "DE" } })).isValid).toBe(false);
  });

  it("requiredIfAnyEmptySiblings / requiredIfAllNotEmptySiblings / requiredIfAnyNotEmptySiblings", async () => {
    const anyEmpty = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        fallback: v.string().requiredIfAnyEmptySiblings(["a", "b"]),
      }),
    });
    expect((await validate(anyEmpty, { g: { a: "A", b: "B", fallback: "F" } })).isValid).toBe(true);
    expect((await validate(anyEmpty, { g: { a: "A" } })).isValid).toBe(false);

    const allNotEmpty = v.object({
      g: v.object({
        first: v.string().optional(),
        last: v.string().optional(),
        full: v.string().requiredIfAllNotEmptySiblings(["first", "last"]),
      }),
    });
    expect((await validate(allNotEmpty, { g: { first: "A" } })).isValid).toBe(true);
    expect((await validate(allNotEmpty, { g: { first: "A", last: "B" } })).isValid).toBe(false);

    const anyNotEmpty = v.object({
      g: v.object({
        phone: v.string().optional(),
        email: v.string().optional(),
        name: v.string().requiredIfAnyNotEmptySiblings(["phone", "email"]),
      }),
    });
    expect((await validate(anyNotEmpty, { g: {} })).isValid).toBe(true);
    expect((await validate(anyNotEmpty, { g: { phone: "1" } })).isValid).toBe(false);
  });

  it("requiredWithAllSiblings / requiredWithAnySiblings / requiredWithoutAllSiblings / requiredWithoutAnySiblings", async () => {
    const withAll = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().requiredWithAllSiblings(["a", "b"]),
      }),
    });
    expect((await validate(withAll, { g: { a: "A" } })).isValid).toBe(true);
    expect((await validate(withAll, { g: { a: "A", b: "B" } })).isValid).toBe(false);

    const withAny = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().requiredWithAnySiblings(["a", "b"]),
      }),
    });
    expect((await validate(withAny, { g: {} })).isValid).toBe(true);
    expect((await validate(withAny, { g: { a: "A" } })).isValid).toBe(false);

    const withoutAll = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().requiredWithoutAllSiblings(["a", "b"]),
      }),
    });
    expect((await validate(withoutAll, { g: { a: "A" } })).isValid).toBe(true);
    expect((await validate(withoutAll, { g: {} })).isValid).toBe(false);

    const withoutAny = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().requiredWithoutAnySiblings(["a", "b"]),
      }),
    });
    expect((await validate(withoutAny, { g: { a: "A", b: "B" } })).isValid).toBe(true);
    expect((await validate(withoutAny, { g: { a: "A" } })).isValid).toBe(false);
  });

  it("requiredIfEmptySiblings (all empty form)", async () => {
    const allEmpty = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().requiredIfAllEmptySiblings(["a", "b"]),
      }),
    });
    expect((await validate(allEmpty, { g: { a: "A" } })).isValid).toBe(true);
    expect((await validate(allEmpty, { g: {} })).isValid).toBe(false);
  });
});

describe("present* sibling variants", () => {
  it("presentWithSibling / presentWithoutSibling / presentUnlessSibling", async () => {
    const withV = v.object({
      g: v.object({
        img: v.string().optional(),
        caption: v.string().presentWithSibling("img").optional(),
      }),
    });
    expect((await validate(withV, { g: {} })).isValid).toBe(true);
    expect((await validate(withV, { g: { img: "x", caption: "" } })).isValid).toBe(true);
    expect((await validate(withV, { g: { img: "x" } })).isValid).toBe(false);

    const withoutV = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().presentWithoutSibling("a").optional(),
      }),
    });
    expect((await validate(withoutV, { g: { a: "y" } })).isValid).toBe(true);
    expect((await validate(withoutV, { g: {} })).isValid).toBe(false);

    const unlessV = v.object({
      g: v.object({
        isDraft: v.boolean(),
        publishDate: v.string().presentUnlessSibling("isDraft", true).optional(),
      }),
    });
    expect((await validate(unlessV, { g: { isDraft: true } })).isValid).toBe(true);
    expect((await validate(unlessV, { g: { isDraft: false } })).isValid).toBe(false);
  });

  it("presentIfEmptySibling / presentIfNotEmptySibling / presentIfNotInSibling", async () => {
    const ifEmpty = v.object({
      g: v.object({
        primary: v.string().optional(),
        fallback: v.string().presentIfEmptySibling("primary").optional(),
      }),
    });
    expect((await validate(ifEmpty, { g: { primary: "m" } })).isValid).toBe(true);
    expect((await validate(ifEmpty, { g: {} })).isValid).toBe(false);

    const ifNotEmpty = v.object({
      g: v.object({
        email: v.string().optional(),
        confirm: v.string().presentIfNotEmptySibling("email").optional(),
      }),
    });
    expect((await validate(ifNotEmpty, { g: {} })).isValid).toBe(true);
    expect((await validate(ifNotEmpty, { g: { email: "e" } })).isValid).toBe(false);

    const ifNotIn = v.object({
      g: v.object({
        kind: v.string(),
        note: v.string().presentIfNotInSibling("kind", ["x", "y"]).optional(),
      }),
    });
    expect((await validate(ifNotIn, { g: { kind: "x" } })).isValid).toBe(true);
    expect((await validate(ifNotIn, { g: { kind: "z" } })).isValid).toBe(false);
  });

  it("presentWithAllSiblings / presentWithAnySiblings / presentWithoutAllSiblings / presentWithoutAnySiblings / presentIfInSibling", async () => {
    const withAll = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().presentWithAllSiblings(["a", "b"]).optional(),
      }),
    });
    expect((await validate(withAll, { g: { a: "A" } })).isValid).toBe(true);
    expect((await validate(withAll, { g: { a: "A", b: "B" } })).isValid).toBe(false);

    const withAny = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().presentWithAnySiblings(["a", "b"]).optional(),
      }),
    });
    expect((await validate(withAny, { g: {} })).isValid).toBe(true);
    expect((await validate(withAny, { g: { a: "A" } })).isValid).toBe(false);

    const withoutAll = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().presentWithoutAllSiblings(["a", "b"]).optional(),
      }),
    });
    expect((await validate(withoutAll, { g: { a: "A" } })).isValid).toBe(true);
    expect((await validate(withoutAll, { g: {} })).isValid).toBe(false);

    const withoutAny = v.object({
      g: v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        c: v.string().presentWithoutAnySiblings(["a", "b"]).optional(),
      }),
    });
    expect((await validate(withoutAny, { g: { a: "A", b: "B" } })).isValid).toBe(true);
    expect((await validate(withoutAny, { g: { a: "A" } })).isValid).toBe(false);

    const ifIn = v.object({
      g: v.object({
        kind: v.string(),
        detail: v.string().presentIfInSibling("kind", ["a", "b"]).optional(),
      }),
    });
    expect((await validate(ifIn, { g: { kind: "c" } })).isValid).toBe(true);
    expect((await validate(ifIn, { g: { kind: "a" } })).isValid).toBe(false);
  });
});

describe("forbidden* sibling variants", () => {
  it("forbiddenIfNotSibling / forbiddenIfEmptySibling / forbiddenIfNotEmptySibling", async () => {
    const ifNot = v.object({
      g: v.object({
        mode: v.string(),
        advanced: v.string().forbiddenIfNotSibling("mode", "expert").optional(),
      }),
    });
    expect((await validate(ifNot, { g: { mode: "expert", advanced: "y" } })).isValid).toBe(true);
    expect((await validate(ifNot, { g: { mode: "basic", advanced: "y" } })).isValid).toBe(false);

    const ifEmpty = v.object({
      g: v.object({
        primary: v.string().optional(),
        child: v.string().forbiddenIfEmptySibling("primary").optional(),
      }),
    });
    expect((await validate(ifEmpty, { g: { primary: "P", child: "C" } })).isValid).toBe(true);
    expect((await validate(ifEmpty, { g: { child: "C" } })).isValid).toBe(false);

    const ifNotEmpty = v.object({
      g: v.object({
        auto: v.string().optional(),
        manual: v.string().forbiddenIfNotEmptySibling("auto").optional(),
      }),
    });
    expect((await validate(ifNotEmpty, { g: { manual: "M" } })).isValid).toBe(true);
    expect((await validate(ifNotEmpty, { g: { auto: "A", manual: "M" } })).isValid).toBe(false);
  });

  it("forbiddenIfInSibling / forbiddenIfNotInSibling", async () => {
    const inV = v.object({
      g: v.object({
        role: v.string(),
        secret: v.string().forbiddenIfInSibling("role", ["guest"]).optional(),
      }),
    });
    expect((await validate(inV, { g: { role: "admin", secret: "s" } })).isValid).toBe(true);
    expect((await validate(inV, { g: { role: "guest", secret: "s" } })).isValid).toBe(false);

    const notInV = v.object({
      g: v.object({
        role: v.string(),
        token: v.string().forbiddenIfNotInSibling("role", ["admin"]).optional(),
      }),
    });
    expect((await validate(notInV, { g: { role: "admin", token: "t" } })).isValid).toBe(true);
    expect((await validate(notInV, { g: { role: "guest", token: "t" } })).isValid).toBe(false);
  });
});

describe("equality methods", () => {
  it("sameAs / sameAsSibling", async () => {
    const global = v.object({
      password: v.string(),
      confirm: v.string().sameAs("password"),
    });
    expect((await validate(global, { password: "x", confirm: "x" })).isValid).toBe(true);
    expect((await validate(global, { password: "x", confirm: "y" })).isValid).toBe(false);

    const sibling = v.object({
      g: v.object({
        a: v.string(),
        b: v.string().sameAsSibling("a"),
      }),
    });
    expect((await validate(sibling, { g: { a: "x", b: "x" } })).isValid).toBe(true);
    expect((await validate(sibling, { g: { a: "x", b: "y" } })).isValid).toBe(false);
  });

  it("differentFrom / differentFromSibling", async () => {
    const global = v.object({
      oldPassword: v.string(),
      newPassword: v.string().differentFrom("oldPassword"),
    });
    expect((await validate(global, { oldPassword: "a", newPassword: "b" })).isValid).toBe(true);
    expect((await validate(global, { oldPassword: "a", newPassword: "a" })).isValid).toBe(false);

    const sibling = v.object({
      g: v.object({
        a: v.string(),
        b: v.string().differentFromSibling("a"),
      }),
    });
    expect((await validate(sibling, { g: { a: "x", b: "y" } })).isValid).toBe(true);
    expect((await validate(sibling, { g: { a: "x", b: "x" } })).isValid).toBe(false);
  });

  it("equal enforces a constant value", async () => {
    expect((await validate(v.string().equal("yes"), "yes")).isValid).toBe(true);
    expect((await validate(v.string().equal("yes"), "no")).isValid).toBe(false);
  });
});

describe("when / whenSibling conditional schema", () => {
  it("when applies a per-value validator based on another field (global)", async () => {
    const schema = v.object({
      contactType: v.string().in(["email", "phone"]),
      contact: v.string().when("contactType", {
        is: {
          email: v.string().email(),
          phone: v.string().pattern(/^\d{10}$/),
        },
      }),
    });

    expect(
      (await validate(schema, { contactType: "email", contact: "a@b.com" })).isValid,
    ).toBe(true);
    expect((await validate(schema, { contactType: "email", contact: "nope" })).isValid).toBe(false);
    expect(
      (await validate(schema, { contactType: "phone", contact: "1234567890" })).isValid,
    ).toBe(true);
    expect((await validate(schema, { contactType: "phone", contact: "12" })).isValid).toBe(false);
  });

  it("when falls back to `otherwise` for unmatched values", async () => {
    // The outer field is optional so presence is controlled by the caller; the
    // `when` rule (requiresValue:true) only runs for present values and then
    // routes to `is[value]` or `otherwise`.
    const schema = v.object({
      role: v.string(),
      extra: v
        .string()
        .optional()
        .when("role", {
          is: { admin: v.string().min(3) },
          otherwise: v.string().max(5),
        }),
    });

    // role not "admin", extra present → otherwise (max 5) applies
    expect((await validate(schema, { role: "user", extra: "ok" })).isValid).toBe(true);
    expect((await validate(schema, { role: "user", extra: "waytoolong" })).isValid).toBe(false);
    // role admin → min(3) applies to the present value
    expect((await validate(schema, { role: "admin", extra: "ab" })).isValid).toBe(false);
    expect((await validate(schema, { role: "admin", extra: "abc" })).isValid).toBe(true);
  });

  it("whenSibling routes based on a sibling field", async () => {
    const schema = v.object({
      g: v.object({
        userType: v.string().in(["admin", "user"]),
        permission: v.string().whenSibling("userType", {
          is: {
            admin: v.string().in(["read", "write", "delete"]),
            user: v.string().in(["read"]),
          },
        }),
      }),
    });

    expect(
      (await validate(schema, { g: { userType: "admin", permission: "delete" } })).isValid,
    ).toBe(true);
    expect(
      (await validate(schema, { g: { userType: "user", permission: "delete" } })).isValid,
    ).toBe(false);
    expect((await validate(schema, { g: { userType: "user", permission: "read" } })).isValid).toBe(
      true,
    );
  });
});

describe("remaining date mutators", () => {
  it("addHours shifts the hour before a time check", async () => {
    // 08:00 + 7h = 15:00 → fromHour(15) passes
    const result = await validate(v.date().addHours(7).fromHour(15), new Date(2023, 5, 15, 8, 0, 0));
    expect(result.isValid).toBe(true);
  });

  it("toStartOfYear / toEndOfYear move to Jan 1 / Dec 31", async () => {
    const start = await validate(
      v.date().toStartOfYear().month(1).minDay(1).maxDay(1),
      "2023-06-15",
    );
    expect(start.isValid).toBe(true);

    const end = await validate(v.date().toEndOfYear().month(12).minDay(31), "2023-06-15");
    expect(end.isValid).toBe(true);
  });

  it("toUTC normalizes the date and still validates", async () => {
    const result = await validate(v.date().toUTC().year(2023), new Date("2023-06-15T12:00:00Z"));
    expect(result.isValid).toBe(true);
    expect(result.data instanceof Date).toBe(true);
  });
});
