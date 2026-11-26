/** Proves what the sign-in and password reset routes refuse. */
import { testGet, testPost } from "@warlock.js/core/tests";
import { describe, expect, it } from "vitest";

describe("sign in", () => {
  // @proves accounts/sign-in AC-1
  it("refuses a wrong email and password with a message", async () => {
    const response = await testPost("/auth/login", {
      email: "nobody@example.com",
      password: "wrong-password",
    });
    const body = await response.json();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(body.error.message).toBeTruthy();
  });

  // @proves accounts/sign-in AC-2
  it("refuses the profile without signing in", async () => {
    const response = await testGet("/auth/me");

    expect(response.status).toBe(401);
  });
});

describe("reset password", () => {
  // @proves accounts/reset-password AC-1
  it("refuses a reset with nothing filled in", async () => {
    const response = await testPost("/auth/reset-password", {});

    expect(response.status).toBe(422);
  });
});
