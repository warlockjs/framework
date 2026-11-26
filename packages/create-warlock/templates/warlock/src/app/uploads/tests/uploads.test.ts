/** Proves a missing uploaded file answers not found. */
import { testGet } from "@warlock.js/core/tests";
import { describe, expect, it } from "vitest";

describe("uploads", () => {
  // @proves accounts/uploads AC-1
  it("answers not found for a file that does not exist", async () => {
    const response = await testGet("/uploads/avatars/does-not-exist.jpg");

    expect(response.status).toBe(404);
  });
});
