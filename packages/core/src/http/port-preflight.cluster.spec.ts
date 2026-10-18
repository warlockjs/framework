import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cluster: { isWorker: true },
  createServer: vi.fn(() => {
    throw new Error("exclusive probe attempted");
  }),
}));
vi.mock("node:cluster", () => ({ default: mocks.cluster }));
vi.mock("node:net", () => ({ createServer: mocks.createServer }));

import { assertPortIsAvailable } from "./port-preflight";

afterEach(() => {
  mocks.cluster.isWorker = true;
  vi.clearAllMocks();
});

describe("cluster listener preflight", () => {
  it("does not exclusively probe the shared listener from a cluster worker", async () => {
    await expect(assertPortIsAvailable(8080, "127.0.0.1")).resolves.toBeUndefined();
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("still probes in a standalone or fork process", async () => {
    mocks.cluster.isWorker = false;
    await expect(assertPortIsAvailable(8080, "127.0.0.1")).rejects.toThrow(
      "exclusive probe attempted",
    );
    expect(mocks.createServer).toHaveBeenCalledOnce();
  });
});
