import { describe, expect, expectTypeOf, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import type { Infer } from "../../../src/types/inference-types";
import type { BaseValidator } from "../../../src/validators/base-validator";

/**
 * Type-level coverage for the `Infer` walker (PACKAGE NOTES calls this out
 * explicitly). The `expectTypeOf` assertions document the input/output shape
 * contract and are enforced under `vitest --typecheck`; the accompanying
 * runtime assertions verify that validated `data` actually matches the shape
 * `Infer.Output` promises, so the file carries weight under the plain runner
 * too.
 *
 * Contracts verified against inference-types.ts.
 */

describe("Infer (type-level)", () => {
  describe("primitives", () => {
    it("maps each primitive validator to its scalar type", () => {
      expectTypeOf<Infer<ReturnType<typeof v.string>>>().toEqualTypeOf<string>();
      expectTypeOf<Infer<ReturnType<typeof v.int>>>().toEqualTypeOf<number>();
      expectTypeOf<Infer<ReturnType<typeof v.float>>>().toEqualTypeOf<number>();
      expectTypeOf<Infer<ReturnType<typeof v.number>>>().toEqualTypeOf<number>();
      expectTypeOf<Infer<ReturnType<typeof v.boolean>>>().toEqualTypeOf<boolean>();
      expectTypeOf<Infer<ReturnType<typeof v.date>>>().toEqualTypeOf<Date>();
      expectTypeOf<Infer<ReturnType<typeof v.scalar>>>().toEqualTypeOf<string | number | boolean>();
    });
  });

  describe("object input vs output keys", () => {
    const schema = v.object({
      name: v.string(),
      email: v.string().email().optional(),
      status: v.string().optional().default("active"),
      retries: v.int().catch(3),
    });

    type In = Infer.Input<typeof schema>;
    type Out = Infer.Output<typeof schema>;

    it("input: optional() / default() / catch() all make the key optional", () => {
      expectTypeOf<In>().toEqualTypeOf<{
        name: string;
        email?: string;
        status?: string;
        retries?: number;
      }>();
    });

    it("output: default() / catch() guarantee the key, optional() alone does not", () => {
      expectTypeOf<Out>().toEqualTypeOf<{
        name: string;
        email?: string;
        status: string;
        retries: number;
      }>();
    });

    it("runtime data matches the Output shape (defaults/catch always present)", async () => {
      const result = await validate(schema, { name: "Hasan", retries: "bad" });
      expect(result.isValid).toBe(true);
      // status defaulted, retries rescued, email omitted
      expect(result.data).toEqual({ name: "Hasan", status: "active", retries: 3 });
    });
  });

  describe("nullable widening", () => {
    it("nullable adds | null; nullish makes the key optional AND nullable", () => {
      const schema = v.object({
        deletedAt: v.date().nullable(),
        note: v.string().nullish(),
      });

      type Out = Infer.Output<typeof schema>;
      expectTypeOf<Out>().toEqualTypeOf<{
        deletedAt: Date | null;
        note?: string | null;
      }>();
    });
  });

  describe("arrays", () => {
    it("infers an array of the item type", () => {
      expectTypeOf<Infer<ReturnType<typeof arrayOfStrings>>>().toEqualTypeOf<string[]>();
      function arrayOfStrings() {
        return v.array(v.string());
      }
    });

    it("infers nested object items", () => {
      const schema = v.array(v.object({ id: v.int(), name: v.string() }));
      type T = Infer<typeof schema>;
      expectTypeOf<T>().toEqualTypeOf<Array<{ id: number; name: string }>>();
    });
  });

  describe("tuples", () => {
    it("infers each position instead of widening to an array of the union", async () => {
      const schema = v.tuple([v.string(), v.int()]);
      expectTypeOf<Infer.Input<typeof schema>>().toEqualTypeOf<[string, number]>();
      expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<[string, number]>();
      expectTypeOf<[number, string]>().not.toExtend<Infer.Output<typeof schema>>();

      const result = await validate(schema, ["a", 1]);
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expectTypeOf(result.data).toEqualTypeOf<[string, number]>();
        expect(result.data).toEqual(["a", 1]);
      }
    });

    it("keeps output-only guarantees per position", () => {
      const schema = v.tuple([v.int().optional().default(1), v.string().nullable()]);
      // A position is never optional, so a standalone validator's own input type applies.
      expectTypeOf<Infer.Input<typeof schema>>().toEqualTypeOf<[number, string | null]>();
      expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<[number, string | null]>();
    });

    it("still accepts a validator array built at runtime", () => {
      const validators: BaseValidator[] = [v.string(), v.int()];
      const schema = v.tuple(validators);
      expectTypeOf<Infer.Output<typeof schema>>().toBeArray();
    });
  });

  describe("literals and enums preserve the union", () => {
    it("literal narrows to the literal union", () => {
      const single = v.literal("items");
      expectTypeOf<Infer<typeof single>>().toEqualTypeOf<"items">();

      const multi = v.literal("draft", "published");
      expectTypeOf<Infer<typeof multi>>().toEqualTypeOf<"draft" | "published">();
    });

    it("v.enum([...]) keeps the literal union rather than widening to string", () => {
      const status = v.enum(["draft", "published"]);
      expectTypeOf<Infer<typeof status>>().toEqualTypeOf<"draft" | "published">();
    });
  });

  describe("nested objects", () => {
    it("recurses through nested object shapes", () => {
      const schema = v.object({
        user: v.object({
          id: v.int(),
          address: v.object({ city: v.string().optional() }),
        }),
      });

      type T = Infer<typeof schema>;
      expectTypeOf<T>().toEqualTypeOf<{
        user: { id: number; address: { city?: string } };
      }>();
    });
  });

  describe("discriminated union", () => {
    it("infers the union of branch shapes", () => {
      const email = v.object({ type: v.literal("email"), email: v.string() });
      const sms = v.object({ type: v.literal("sms"), phone: v.string() });
      const notif = v.discriminatedUnion("type", [email, sms]);

      type T = Infer<typeof notif>;
      expectTypeOf<T>().toEqualTypeOf<
        { type: "email"; email: string } | { type: "sms"; phone: string }
      >();
    });
  });
});
