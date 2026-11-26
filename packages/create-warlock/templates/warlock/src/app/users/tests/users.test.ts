/** Proves the user list needs a signed-in administrator. */
import { testGet } from "@warlock.js/core/tests";
import { describe, expect, it } from "vitest";

describe("users", () => {
  // @proves accounts/users AC-1
  it("refuses the user list without signing in", async () => {
    const response = await testGet("/users");

    expect(response.status).toBe(401);
  });
});
