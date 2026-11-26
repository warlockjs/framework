/** Proves the language switch only takes the languages the project offers. */
import { testPost } from "@warlock.js/core/tests";
import { describe, expect, it } from "vitest";

describe("language switch", () => {
  // @proves design-system/language AC-1
  it("refuses a language the project does not offer", async () => {
    const response = await testPost("/api/locale", { locale: "xx" });

    expect(response.status).toBe(422);
  });
});
