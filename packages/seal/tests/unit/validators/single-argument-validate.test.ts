import { afterEach, describe, expect, it } from "vitest";
import { configureSeal, resetSealConfig } from "../../../src/config";
import { v } from "../../../src/factory";

afterEach(() => resetSealConfig());

describe("schema.validate(data) with one argument", () => {
  it("enforces requiredIf like v.validate(schema, data)", async () => {
    const schema = v.object({
      status: v.string(),
      note: v.string().requiredIf("status", "fixed"),
    });

    const viaFactory = await v.validate(schema, { status: "fixed" });
    const direct = await schema.validate({ status: "fixed" });

    expect(viaFactory.isValid).toBe(false);
    expect(direct.isValid).toBe(false);
    expect(direct.errors[0].error).toBe(viaFactory.errors[0].error);

    expect((await schema.validate({ status: "open" })).isValid).toBe(true);
    expect((await schema.validate({ status: "fixed", note: "done" })).isValid).toBe(true);
  });

  it("enforces requiredIfIn, requiredWith and requiredWithout", async () => {
    const schema = v.object({
      kind: v.string(),
      a: v.string().requiredIfIn("kind", ["x", "y"]),
      b: v.string().optional(),
      c: v.string().requiredWith("b"),
      d: v.string().requiredWithout("b"),
    });

    const result = await schema.validate({ kind: "x", b: "1" });
    expect(result.isValid).toBe(false);
    expect(result.errors.map((e) => e.input).sort()).toEqual(["a", "c"]);

    const result2 = await schema.validate({ kind: "z" });
    expect(result2.errors.map((e) => e.input)).toEqual(["d"]);
  });

  it("enforces sibling variants inside nested objects", async () => {
    const schema = v.object({
      address: v.object({
        en: v.string().optional(),
        ar: v.string().requiredWithoutSibling("en"),
        kind: v.string(),
        zip: v.string().requiredIfSibling("kind", "home"),
        extra: v.string().requiredWithSibling("en"),
      }),
    });

    const bad = await schema.validate({ address: { kind: "home" } });
    expect(bad.isValid).toBe(false);
    expect(bad.errors).toHaveLength(2);

    const bad2 = await schema.validate({ address: { en: "x", kind: "work" } });
    expect(bad2.isValid).toBe(false);

    const ok = await schema.validate({ address: { en: "x", kind: "work", extra: "y" } });
    expect(ok.isValid).toBe(true);
  });

  it("enforces conditional rules for items inside arrays", async () => {
    const schema = v.object({
      items: v.array(
        v.object({
          type: v.string(),
          value: v.string().requiredIfSibling("type", "text"),
        }),
      ),
    });

    const bad = await schema.validate({ items: [{ type: "text" }, { type: "none" }] });
    expect(bad.isValid).toBe(false);
    expect(bad.errors).toHaveLength(1);

    expect((await schema.validate({ items: [{ type: "text", value: "a" }] })).isValid).toBe(true);
  });

  it("uses the global config defaults like the factory does", async () => {
    configureSeal({ translateRule: () => "custom message" });
    const schema = v.object({ a: v.string() });
    const result = await schema.validate({});
    expect(result.errors[0].error).toBe("custom message");
  });

  it("works for non-object validators called without a context", async () => {
    expect((await v.string().required().validate("")).isValid).toBe(false);
    expect((await v.array(v.string()).validate(["a"])).isValid).toBe(true);
    expect((await v.record(v.string()).validate({ a: "b" })).isValid).toBe(true);
    expect((await v.tuple([v.string(), v.number()]).validate(["a", 1])).isValid).toBe(true);
  });
});

describe("labelling fields through translateAttribute", () => {
  const labels: Record<string, string> = { subject_en: "Email subject" };
  const translateAttribute = ({ attribute }: { attribute: string }) => labels[attribute] ?? "";
  const schema = v.object({ subject_en: v.string().required() });

  it("maps keys to labels on validate options", async () => {
    const result = await v.validate(schema, {}, { translateAttribute });
    expect(result.errors[0].error).toBe("The Email subject is required");
  });

  it("maps keys to labels through configureSeal", async () => {
    configureSeal({ translateAttribute });
    const result = await schema.validate({});
    expect(result.errors[0].error).toBe("The Email subject is required");
  });

  it("keeps the raw key when the map has no entry and .label() wins per field", async () => {
    const other = v.object({
      other_key: v.string().required(),
      subject_en: v.string().label("Subject").required(),
    });
    const result = await v.validate(other, {}, { translateAttribute });
    const messages = result.errors.map((e) => e.error);
    expect(messages).toContain("The other_key is required");
    expect(messages).toContain("The Subject is required");
  });
});
