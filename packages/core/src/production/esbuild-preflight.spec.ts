import { beforeEach, describe, expect, it, vi } from "vitest";

const transformSyncMock = vi.fn();

beforeEach(() => {
  transformSyncMock.mockClear();
});

vi.mock("esbuild", () => ({
  default: { transformSync: (...args: unknown[]) => transformSyncMock(...args) },
}));

/**
 * `warlock build` must fail fast, with a clear
 * message, when esbuild's native binary was never linked (the state pnpm
 * leaves a project in when its build-script approval gate blocks esbuild's
 * postinstall), instead of letting esbuild's own cryptic error surface mid
 * bundle.
 */
describe("assertEsbuildBinaryIsLinked (07c4775f/2)", () => {
  it("turns esbuild's known unlinked-binary error into a friendly one naming the cause and the fix", async () => {
    transformSyncMock.mockImplementation(() => {
      throw new Error(
        'The package "@esbuild/win32-x64" could not be found, and is needed by esbuild.',
      );
    });

    const { assertEsbuildBinaryIsLinked } = await import("./esbuild-preflight");

    expect(() => assertEsbuildBinaryIsLinked()).toThrow(/pnpm approve-builds/);
  });

  it("is a no-op when esbuild is healthy", async () => {
    transformSyncMock.mockImplementation(() => ({ code: "" }));

    const { assertEsbuildBinaryIsLinked } = await import("./esbuild-preflight");

    expect(() => assertEsbuildBinaryIsLinked()).not.toThrow();
    expect(transformSyncMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows an unrelated esbuild error unchanged", async () => {
    const unrelatedError = new Error("Unexpected token in JS syntax");
    transformSyncMock.mockImplementation(() => {
      throw unrelatedError;
    });

    const { assertEsbuildBinaryIsLinked } = await import("./esbuild-preflight");

    expect(() => assertEsbuildBinaryIsLinked()).toThrow(unrelatedError);
  });
});
