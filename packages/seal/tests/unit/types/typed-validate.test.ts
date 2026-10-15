import { describe, expect, expectTypeOf, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import type { ValidationResult } from "../../../src/types";
import type { Infer } from "../../../src/types/inference-types";
import type { BaseValidator, ObjectValidator } from "../../../src/validators";

/**
 * WR-020 (Bureau 0.30): `validate()` returned `data: any`, `~standard.validate`
 * on a discriminated union resolved to `unknown`. The `expectTypeOf` assertions are enforced under
 * `vitest --typecheck`; the runtime assertions keep the file honest under the
 * plain runner.
 */

describe("validate() result typing", () => {
  const schema = v.object({
    name: v.string(),
    status: v.string().optional().default("active"),
  });

  it("narrows data to the schema output on success", async () => {
    const result = await validate(schema, { name: "Hasan" });

    if (result.isValid) {
      expectTypeOf(result.data).toEqualTypeOf<Infer.Output<typeof schema>>();
      expect(result.data).toEqual({ name: "Hasan", status: "active" });
    } else {
      expectTypeOf(result.data).toEqualTypeOf<undefined>();
      throw new Error("expected a valid result");
    }
  });

  it("types failed data as undefined", async () => {
    const result = await validate(schema, {});

    expect(result.isValid).toBe(false);

    if (!result.isValid) {
      expectTypeOf(result.data).toEqualTypeOf<undefined>();
      expect(result.data).toBeUndefined();
    }
  });

  it("is still assignable to the plain ValidationResult", async () => {
    const result: ValidationResult = await validate(schema, { name: "Hasan" });

    expect(result.isValid).toBe(true);
  });

  it("keeps data as any for an untyped schema", async () => {
    const untyped: BaseValidator = v.string();
    const wide: ObjectValidator = v.object({ id: v.string() });

    const first = await validate(untyped, "x");
    const second = await validate(wide, { id: "x" });

    if (first.isValid && second.isValid) {
      expectTypeOf(first.data).toBeAny();
      expectTypeOf(second.data).toBeAny();
    }

    expect(first.isValid && second.isValid).toBe(true);
  });
});

describe("discriminated union ~standard typing", () => {
  const notification = v.discriminatedUnion("type", [
    v.object({ type: v.literal("email"), email: v.string() }),
    v.object({ type: v.literal("sms"), phone: v.string() }),
  ]);

  it("resolves the Standard Schema output to the branch union", async () => {
    const result = await notification["~standard"].validate({ type: "sms", phone: "555" });

    if (!result.issues) {
      expectTypeOf(result.value).toEqualTypeOf<Infer.Output<typeof notification>>();
      expect(result.value).toEqual({ type: "sms", phone: "555" });
    } else {
      throw new Error("expected a valid result");
    }
  });
});
