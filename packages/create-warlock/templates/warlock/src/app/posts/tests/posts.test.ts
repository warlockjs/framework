/** Proves a post needs a signed-in person. */
import { testPost } from "@warlock.js/core/tests";
import { describe, expect, it } from "vitest";

describe("posts", () => {
  // @proves accounts/posts AC-1
  it("refuses a new post without signing in", async () => {
    const response = await testPost("/posts", { title: "Hello", description: "A first post" });

    expect(response.status).toBe(401);
  });
});
