import { describe, expect, it } from "vitest";
import { loadQueuePackage, QueuePackageNotInstalledError } from "../../../src";

describe("loadQueuePackage (bullmqQueue's lazy optional-peer loader)", () => {
  it("throws QueuePackageNotInstalledError when the dynamic import fails", async () => {
    const failingLoader = () => Promise.reject(new Error("Cannot find module '@warlock.js/queue'"));

    await expect(loadQueuePackage(failingLoader)).rejects.toBeInstanceOf(QueuePackageNotInstalledError);
  });

  it("names the install command in the error message", async () => {
    const failingLoader = () => Promise.reject(new Error("not found"));

    await expect(loadQueuePackage(failingLoader)).rejects.toThrow("warlock add queue");
  });

  it("resolves the module when the loader succeeds", async () => {
    const fakeModule = { defineJob: () => undefined } as unknown as typeof import("@warlock.js/queue");
    const loader = () => Promise.resolve(fakeModule);

    await expect(loadQueuePackage(loader)).resolves.toBe(fakeModule);
  });
});
