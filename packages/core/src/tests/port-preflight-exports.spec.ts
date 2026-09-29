import { describe, expect, expectTypeOf, it } from "vitest";
import { assertPortIsAvailable, isPortAvailable } from "./index";

describe("tests barrel port preflight exports", () => {
  it("exports the port helpers and can probe a free port", async () => {
    expectTypeOf(assertPortIsAvailable).toBeFunction();

    // The probe deliberately `unref()`s its temporary listener. Keep this
    // isolated Vitest worker alive until its listening callback resolves.
    const keepAlive = setInterval(() => undefined, 1_000);

    try {
      await expect(isPortAvailable(0)).resolves.toBe(true);
    } finally {
      clearInterval(keepAlive);
    }
  });
});
