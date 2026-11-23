import { describe, expect, it } from "vitest";
import { DEFAULT_GRIMOIRE_SETTINGS } from "../contracts/settings";
import { parseSettings, resolveSettings } from "./settings";
import { FindingSink } from "./sink";

function parse(text: string) {
  const findings: ConstructorParameters<typeof FindingSink>[0] = [];
  const written = parseSettings("grimoire/settings.md", text, new FindingSink(findings));

  return { written, codes: findings.map((finding) => `${finding.code}:${finding.at?.line}`) };
}

const FULL = `---
languages: [en, ar]
screenshots: all
rules: [logical-css, no-js-imports]
protected:
  - payments src/app/payments/** src/config/payments.ts
  - auth src/app/auth/**
---
`;

describe("parseSettings", () => {
  it("reads every key", () => {
    const { written, codes } = parse(FULL);

    expect(codes).toEqual([]);
    expect(written.languages.map((language) => language.value)).toEqual(["en", "ar"]);
    expect(written.screenshots?.value).toBe("all");
    expect(written.rules?.map((rule) => rule.value)).toEqual(["logical-css", "no-js-imports"]);
    expect(written.protected.map((line) => [line.name, line.globs])).toEqual([
      ["payments", ["src/app/payments/**", "src/config/payments.ts"]],
      ["auth", ["src/app/auth/**"]],
    ]);
  });

  it("reports an unknown key (GR1005) and a wrong mode or rule (GR1004)", () => {
    const { codes } = parse("---\nthemes: [dark]\nscreenshots: sometimes\nrules: [tabs]\n---\n");

    expect(codes).toEqual(["GR1005:2", "GR1004:3", "GR1004:4"]);
  });

  it("tells absent rules from empty rules", () => {
    expect(parse("---\nlanguages: [en]\n---\n").written.rules).toBeNull();
    expect(parse("---\nrules: []\n---\n").written.rules).toEqual([]);
  });
});

describe("resolveSettings", () => {
  it("gives the defaults for a project without the file", () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_GRIMOIRE_SETTINGS);
  });

  it("prefers the written languages, then the adapter's, then none", () => {
    const written = parse(FULL).written;

    expect(resolveSettings(written, ["fr"])).toMatchObject({
      languages: ["en", "ar"],
      languagesFrom: "settings",
    });
    expect(resolveSettings(parse("---\nscreenshots: off\n---\n").written, ["fr", "de"])).toMatchObject({
      languages: ["fr", "de"],
      languagesFrom: "adapter",
      screenshots: "off",
    });
    expect(resolveSettings(null, [])).toMatchObject({ languages: [], languagesFrom: "none" });
  });

  it("lets a protected line replace a built-in area and add a new one", () => {
    const settings = resolveSettings(parse(FULL).written);

    expect(settings.protected.find((area) => area.name === "auth")?.globs).toEqual(["src/app/auth/**"]);
    expect(settings.protected.find((area) => area.name === "payments")?.globs).toEqual([
      "src/app/payments/**",
      "src/config/payments.ts",
    ]);
    expect(settings.protected.find((area) => area.name === "migrations")).toBeDefined();
    expect(settings.rules).toEqual(["logical-css", "no-js-imports"]);
  });
});
