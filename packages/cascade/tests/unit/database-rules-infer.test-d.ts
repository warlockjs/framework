import { type Infer, v } from "@warlock.js/seal";
import { describe, expectTypeOf, it } from "vitest";
import "../../src/validation/plugins/database-rules-plugin";

describe("database rules keep Infer type", () => {
  it("unique/exists preserve output type", () => {
    const schema = v.object({
      email: v.email().unique("users"),
      id: v.number().exists("users"),
    });
    expectTypeOf<Infer<typeof schema>>().toEqualTypeOf<{ email: string; id: number }>();
  });
});
