import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLegacyLocalesWarningForTests, warnForLegacyLocales } from "./legacy-locales-warning";

vi.mock("@warlock.js/logger", () => ({
  log: { warn: vi.fn() },
}));

describe("legacy locales.ts development warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLegacyLocalesWarningForTests();
  });

  afterEach(resetLegacyLocalesWarningForTests);

  it("warns once across repeated loads and names the legacy file count", () => {
    warnForLegacyLocales(["src/app/access/utils/locales.ts", "src/app/blog/utils/locales.ts"]);
    warnForLegacyLocales(["src/app/access/utils/locales.ts"]);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      "localization",
      "legacy-locales",
      expect.stringContaining("2 legacy utils/locales.ts files"),
    );
    expect(log.warn).toHaveBeenCalledWith(
      "localization",
      "legacy-locales",
      expect.stringContaining("warlock doctor --fix"),
    );
  });

  it("names each legacy file", () => {
    warnForLegacyLocales([
      "src/app/access/utils/locales.ts",
      "src/app/blog/utils/locales.json",
      "src/app/blog/utils/locales.ts",
    ]);

    const message = vi.mocked(log.warn).mock.calls[0]?.[2] as string;

    expect(message).toContain("src/app/access/utils/locales.ts");
    expect(message).toContain("src/app/blog/utils/locales.ts");
    expect(message).not.toContain("src/app/blog/utils/locales.json");
  });

  it("does not warn without legacy locales.ts files, including JSON-only apps", () => {
    warnForLegacyLocales([]);
    warnForLegacyLocales(["src/app/access/utils/locales.json"]);

    expect(log.warn).not.toHaveBeenCalled();
  });
});
