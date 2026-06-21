import { describe, expect, it } from "vitest";
import { closeServerWithTimeout } from "../../../src/http/server";

describe("closeServerWithTimeout", () => {
  it("returns true when the server drains before the timeout", async () => {
    const server = { close: () => new Promise<void>((resolve) => setTimeout(resolve, 5)) };

    await expect(closeServerWithTimeout(server, 100)).resolves.toBe(true);
  });

  it("returns false when draining exceeds the timeout", async () => {
    const server = { close: () => new Promise<void>((resolve) => setTimeout(resolve, 100)) };

    await expect(closeServerWithTimeout(server, 10)).resolves.toBe(false);
  });

  it("returns true immediately for an already-closed server", async () => {
    const server = { close: () => Promise.resolve() };

    await expect(closeServerWithTimeout(server, 1000)).resolves.toBe(true);
  });
});
