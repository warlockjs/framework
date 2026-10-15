import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The feature only touches the filesystem through this facade; stub every call
// so `onExecuting` runs to completion and prints its guidance without writing
// anything into the repo the test runs in.
vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => false),
  getFileAsync: vi.fn(async () => ""),
  putFileAsync: vi.fn(async () => undefined),
  ensureDirectoryAsync: vi.fn(async () => undefined),
}));

import type { CommandActionData } from "../../commands/types";
import { shadcnFeature } from "./shadcn.feature";

/** Drop ANSI colour escapes so assertions match on words, not escape codes. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

describe("add shadcn — printed guidance tracks upstream shadcn CLI", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("tells the user that shadcn now sources cn from the `cn` package", async () => {
    await shadcnFeature.onExecuting?.({} as CommandActionData);

    const printed = logSpy.mock.calls.flat().join("\n").replace(ANSI, "");

    // As of shadcn's September 2026 change, `shadcn add` installs the `cn`
    // package and generated components import `cn` from it, not from the
    // scaffolded src/web/lib/utils.ts. The guidance must say so, or a user
    // sees an unexpected `cn` dependency and imports they cannot account for.
    expect(printed).toMatch(/from "cn"/);
  });
});
