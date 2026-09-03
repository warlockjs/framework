/**
 * Type-level coverage for the `@warlock.js/seal` `ValidatorV` augmentation in
 * `core/src/validation/types.ts`.
 *
 * The augmentation adds `v.file()` and `v.localized()` to the seal `v`
 * factory. Both must intersect their factory's return type with
 * `StandardSchemaV1<Output>` — the same convention seal's own native
 * factories use (see `seal/src/factory/validators.ts`, e.g. `record: … =>
 * … & StandardSchemaV1<Record<string, Infer<T>>>`). Without that
 * intersection, `Infer<T>`'s walker (`seal/src/types/inference-types.ts`)
 * cannot find an output type for the branch and falls through to `unknown`.
 *
 * `v.file()` shipped without the intersection: `Infer<typeof schema>`
 * resolved any file field to `unknown` instead of `UploadedFile`, so
 * `const { avatar } = request.validated()` produced `TS18046: 'avatar' is
 * of type 'unknown'`. This file is the compile-time regression guard for
 * that defect (and for `v.localized()`, which had the same shape of bug).
 *
 * These `expectTypeOf` assertions are enforced under `tsc -p
 * tsconfig.typecheck.json` (`pnpm typecheck` in this package) — see
 * `seal/tests/unit/types/infer.test.ts` for the established pattern this
 * file follows. They are inert at plain runtime (no assertion can fail
 * here without a compiler run), so the accompanying runtime `it` bodies are
 * intentionally trivial no-ops that only exist to host the type assertions
 * for the `describe`/`it` structure required by the vitest `tests/{unit,
 * integration}/**\/*.test.ts` include glob.
 */
import { v } from "@warlock.js/seal";
import type { Infer } from "@warlock.js/seal";
import { describe, expectTypeOf, it } from "vitest";
import type { UploadedFile } from "../../../src/http";
// Registers `v.file()` / `v.localized()` at runtime (mirrors
// `file-rules.test.ts`) and brings the `ValidatorV` type augmentation from
// `validation/types.ts` into scope for `v.file`/`v.localized` to type-check.
import "../../../src/validation/init";

describe("ValidatorV augmentation (type-level)", () => {
  describe("v.file()", () => {
    it("infers a file field as UploadedFile, not unknown", () => {
      const schema = v.object({
        avatar: v.file(),
      });

      type Out = Infer<typeof schema>;

      expectTypeOf<Out["avatar"]>().toEqualTypeOf<UploadedFile>();
      expectTypeOf<Out["avatar"]>().not.toBeUnknown();
    });
  });

  describe("v.localized()", () => {
    it("infers each entry's value using the given value validator, not unknown", () => {
      const schema = v.object({
        names: v.localized(v.string()),
      });

      type Out = Infer<typeof schema>;
      type Entry = Out["names"] extends Array<infer E> ? E : never;

      expectTypeOf<Entry["localeCode"]>().toEqualTypeOf<string>();
      expectTypeOf<Entry["value"]>().toEqualTypeOf<string>();
      expectTypeOf<Entry["value"]>().not.toBeUnknown();
    });
  });
});
