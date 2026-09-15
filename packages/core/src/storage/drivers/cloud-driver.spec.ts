import { describe, expect, it, vi } from "vitest";
import type { CloudStorageDriverOptions } from "../types";

/**
 * Simulate the S3 SDK packages being absent (the state `warlock add s3`
 * fixes) — both the async `import()` path and the synchronous
 * `createRequire` fallback resolve through this mocked graph, so both
 * loaders fail the same way an uninstalled package would.
 */
vi.mock("@aws-sdk/client-s3", () => {
  throw new Error("Cannot find module '@aws-sdk/client-s3'");
});

vi.mock("@aws-sdk/lib-storage", () => {
  throw new Error("Cannot find module '@aws-sdk/lib-storage'");
});

vi.mock("@aws-sdk/s3-request-presigner", () => {
  throw new Error("Cannot find module '@aws-sdk/s3-request-presigner'");
});

const missingS3Packages = new Set([
  "@aws-sdk/client-s3",
  "@aws-sdk/lib-storage",
  "@aws-sdk/s3-request-presigner",
]);

// `CloudDriver`'s synchronous fallback resolves packages through Node's own
// `createRequire`, which bypasses Vite's mock graph — stub it directly so the
// "SDK missing" branch is reachable from a unit test without a real
// uninstalled package.
vi.mock("module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("module")>();

  return {
    ...actual,
    createRequire: (...args: Parameters<typeof actual.createRequire>) => {
      const realRequire = actual.createRequire(...args);
      const fakeRequire = (specifier: string) => {
        if (missingS3Packages.has(specifier)) {
          throw new Error(`Cannot find module '${specifier}'`);
        }

        return realRequire(specifier);
      };

      return Object.assign(fakeRequire, realRequire);
    },
  };
});

/**
 * Card 07c4775f item 1 — when the S3 SDK is missing, the constructor's error
 * must lead with `warlock add s3` (the framework's own installer) and keep
 * the raw package names only as a secondary hint, instead of telling users
 * to run a raw `npm install` first.
 */
describe("CloudDriver missing S3 SDK message (07c4775f/1)", () => {
  it("names `warlock add s3` as the fix, with raw package names as a secondary hint", async () => {
    const { CloudDriver } = await import("./cloud-driver");

    class TestCloudDriver extends CloudDriver<CloudStorageDriverOptions> {
      public readonly name = "s3";

      public url(location: string): string {
        return location;
      }
    }

    let thrownError: Error | undefined;

    try {
      new TestCloudDriver({} as CloudStorageDriverOptions);
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toContain("warlock add s3");
    expect(thrownError?.message).toContain("@aws-sdk/client-s3");
    expect(thrownError?.message).toContain("@aws-sdk/lib-storage");
    expect(thrownError?.message).toContain("@aws-sdk/s3-request-presigner");
  });
});
