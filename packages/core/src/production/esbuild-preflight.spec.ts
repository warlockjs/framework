import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertEsbuildBinaryIsLinked, EsbuildBinaryMissingError } from "./esbuild-preflight";

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

/**
 * These tests inject the probe directly instead of mocking the `esbuild`
 * module, so nothing about a real install is touched or deleted.
 */
describe("assertEsbuildBinaryIsLinked with an injected probe", () => {
  it("throws a named EsbuildBinaryMissingError naming the cause and the fix when the probe reports an unlinked binary", () => {
    const probe = () => {
      throw new Error(
        'The package "@esbuild/win32-x64" could not be found, and is needed by esbuild.',
      );
    };

    expect(() => assertEsbuildBinaryIsLinked(probe)).toThrow(EsbuildBinaryMissingError);
    expect(() => assertEsbuildBinaryIsLinked(probe)).toThrow(/pnpm approve-builds/);
    expect(() => assertEsbuildBinaryIsLinked(probe)).toThrow(/@esbuild\/win32-x64|native binary/);
  });

  it("passes when the injected probe represents a working esbuild install", () => {
    let calls = 0;
    const probe = () => {
      calls += 1;
    };

    expect(() => assertEsbuildBinaryIsLinked(probe)).not.toThrow();
    expect(calls).toBe(1);
  });
});
