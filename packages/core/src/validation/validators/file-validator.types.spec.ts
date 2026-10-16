import type { Infer } from "@warlock.js/seal";
import { v } from "@warlock.js/seal";
import { describe, expectTypeOf, it } from "vitest";
import type { UploadedFile } from "../../http";
import "../init";

/**
 * Type-level coverage for the `v.file()` chain. Every rule method
 * returns `this`, so the `UploadedFile` output declared by `v.file()` survives
 * `.maxSize()`, `.image()`, `.accept()` and the rest. The assertions are
 * enforced by `tsc -p tsconfig.typecheck.json`.
 */
describe("v.file() chain output type", () => {
  it("keeps UploadedFile through rule methods", () => {
    const schema = v.file().image().maxSize(1024).accept(["png"]).mimeType("image/png");

    expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<UploadedFile>();
  });

  it("keeps UploadedFile on an object field", () => {
    const schema = v.object({ avatar: v.file().maxSize({ size: 2, unit: "MB" }) });

    expectTypeOf<Infer.Output<typeof schema>["avatar"]>().toEqualTypeOf<UploadedFile>();
  });
});
