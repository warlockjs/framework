import { describe, expect, it } from "vitest";
import {
  featureOfLocaleJson,
  isModuleLocaleJsonPath,
  MODULE_LOCALE_JSON_GLOBS,
  moduleOfLocaleJson,
} from "./module-locale-paths";

describe("module locale paths", () => {
  it("recognises a module dictionary and its per-feature files", () => {
    expect(isModuleLocaleJsonPath("src/app/orders/utils/locales.json")).toBe(true);
    expect(isModuleLocaleJsonPath("src/app/orders/utils/locales/refunds.json")).toBe(true);
    expect(isModuleLocaleJsonPath("src\\app\\orders\\utils\\locales\\refunds.json")).toBe(true);
    expect(isModuleLocaleJsonPath("app/orders/utils/locales/refunds.json")).toBe(true);
  });

  it("ignores other JSON, nested folders and other layouts", () => {
    expect(isModuleLocaleJsonPath("src/app/orders/data/seed.json")).toBe(false);
    expect(isModuleLocaleJsonPath("src/app/orders/utils/locales/deep/refunds.json")).toBe(false);
    expect(isModuleLocaleJsonPath("src/app/orders/utils/locales.ts")).toBe(false);
    expect(isModuleLocaleJsonPath("src/web/orders/locales.json")).toBe(false);
  });

  it("names the module that owns a dictionary, whatever its depth in utils/", () => {
    expect(moduleOfLocaleJson("src/app/orders/utils/locales.json")).toBe("orders");
    expect(moduleOfLocaleJson("src/app/orders/utils/locales/refunds.json")).toBe("orders");
    expect(moduleOfLocaleJson("src/app/orders/utils/other.json")).toBeUndefined();
  });

  it("names the feature of a per-feature file only", () => {
    expect(featureOfLocaleJson("src/app/orders/utils/locales/refunds.json")).toBe("refunds");
    expect(featureOfLocaleJson("src/app/orders/utils/locales.json")).toBeUndefined();
  });

  it("exposes one glob per layout", () => {
    expect(MODULE_LOCALE_JSON_GLOBS).toEqual([
      "app/*/utils/locales.json",
      "app/*/utils/locales/*.json",
    ]);
  });
});
