import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { $registerUseCase } from "../use-cases/use-cases-registry";
import { installReRegistrationSilencer, prepareFreshFile } from "./fresh-module-graph";

const KEY = Symbol.for("@warlock.js/test:silence-re-registration");

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
  vi.restoreAllMocks();
});

describe("duplicate registration warnings under a fresh module graph per file", () => {
  it("warns about a duplicate use case by default", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);

    $registerUseCase("dup-a", {} as never);
    $registerUseCase("dup-a", {} as never);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("counts a name an earlier file registered, and still warns inside one file", async () => {
    const silencer = installReRegistrationSilencer();

    $registerUseCase("dup-b", {} as never); // file one
    expect(silencer.count).toBe(0);

    vi.stubEnv("WARLOCK_TEST_PROFILE", "1");
    await prepareFreshFile(); // boundary: count restarts
    expect(silencer.count).toBe(0);

    $registerUseCase("dup-b", {} as never); // file two re-imports the module
    expect(silencer.count).toBe(1);

    // The boundary restored every spy; watch again.
    const warnAgain = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);

    $registerUseCase("dup-b", {} as never); // a second module in the same file
    expect(warnAgain).toHaveBeenCalledTimes(1);

    vi.stubEnv("WARLOCK_TEST_PROFILE", "1");
    const debugAgain = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    await prepareFreshFile(); // boundary: one debug line for the hidden warning
    expect(debugAgain).toHaveBeenCalledTimes(1);
  });
});
