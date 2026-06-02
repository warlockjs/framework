import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAppConfig } from "../../../src/config/config-handlers";

/**
 * `registerAppConfig` is the "app" special-config handler: it eagerly loads the
 * dayjs locale bundle for every configured locale (skipping "en", the default)
 * and warns — without throwing — when a locale bundle cannot be imported.
 * Source: core/src/config/config-handlers.ts.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerAppConfig", () => {
  it("resolves without warning when only the default locale is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(registerAppConfig({ locales: ["en"] } as never)).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });

  it("defaults to the 'en' locale when none are configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(registerAppConfig({} as never)).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });

  it("loads a real non-default locale bundle without warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // "fr" ships with dayjs, so the dynamic import resolves.
    await registerAppConfig({ locales: ["en", "fr"] } as never);

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns but does not throw for an unknown locale bundle", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      registerAppConfig({ locales: ["definitely-not-a-locale"] } as never),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("definitely-not-a-locale");
  });
});
