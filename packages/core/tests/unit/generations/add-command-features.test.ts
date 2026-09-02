import { describe, expect, it, vi } from "vitest";

const execSync = vi.fn();

vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => execSync(...args),
}));

const {
  allowedFeatures,
  featuresMap,
  installDependencies,
  resolveWarlockDependencyVersions,
} = await import("../../../src/generations/add-command.action");
import { INSTALLED_WARLOCK_VERSION } from "../../../src/generations/features/types";

/**
 * Unit coverage for the `warlock add` feature registry — a pure data map, so
 * these assertions stay fs-free. They guard the AI scaffolding wiring: the `ai`
 * feature ejects config/ai.ts, the provider keys carry the `ai-` prefix (the
 * un-prefixed aliases are gone), and the three satellites exist and require the
 * core `ai` feature. create-warlock can reuse `allowedFeatures` as a CI guard.
 */
describe("add command feature registry", () => {
  it("ejects config/ai.ts for the ai feature", () => {
    expect(featuresMap.ai.ejectConfig?.name).toBe("ai");
    expect(featuresMap.ai.ejectConfig?.content).toContain("@warlock.js/ai");
  });

  it("namespaces the provider features under the ai- prefix", () => {
    const providers = ["ai-openai", "ai-google", "ai-anthropic", "ai-bedrock", "ai-ollama"];

    for (const provider of providers) {
      expect(allowedFeatures).toContain(provider);
      expect(featuresMap[provider].requires).toEqual(["ai"]);
    }
  });

  it("drops the un-prefixed provider keys", () => {
    const legacy = ["openai", "google", "anthropic", "bedrock", "ollama"];

    for (const key of legacy) {
      expect(allowedFeatures).not.toContain(key);
    }
  });

  it("registers the satellite features requiring the core ai feature", () => {
    const satellites = ["ai-tools", "ai-panoptic", "ai-workspace"];

    for (const satellite of satellites) {
      expect(allowedFeatures).toContain(satellite);
      expect(featuresMap[satellite].requires).toEqual(["ai"]);
    }
  });

  it("keeps the Web starter's direct browser dependencies scoped to Web", () => {
    expect(featuresMap.web.dependencies).toMatchObject({
      "@mongez/http": "^3.5.0",
      "@mongez/react-form": "^4.0.0",
      "@mongez/react-localization": "^3.4.7",
    });
    expect(featuresMap.web.dependencies).not.toHaveProperty("@mongez/react-atom");
    expect(featuresMap.web.dependencies).not.toHaveProperty("@mongez/atomic-query");
  });

  it("uses one explicit installed-Core placeholder for every Warlock feature dependency", () => {
    const warlockDependencies = Object.values(featuresMap).flatMap(feature =>
      Object.entries(feature.dependencies ?? {}).filter(([name]) =>
        name.startsWith("@warlock.js/"),
      ),
    );

    expect(warlockDependencies).not.toHaveLength(0);
    expect(new Set(warlockDependencies.map(([, version]) => version))).toEqual(
      new Set([INSTALLED_WARLOCK_VERSION]),
    );
  });

  it("resolves Warlock feature dependencies to installed Core without touching other packages", () => {
    const dependencies = {
      "@warlock.js/web": INSTALLED_WARLOCK_VERSION,
      "@warlock.js/auth": INSTALLED_WARLOCK_VERSION,
      react: "^19.2.3",
    };

    resolveWarlockDependencyVersions(dependencies, "5.1.0");

    expect(dependencies).toEqual({
      "@warlock.js/web": "5.1.0",
      "@warlock.js/auth": "5.1.0",
      react: "^19.2.3",
    });
  });
});

describe("add command dependency installation", () => {
  it("passes declared versions and ranges to production and development installs", async () => {
    await installDependencies(
      "npm",
      { react: "^19.2.3", "@warlock.js/web": "5.2.0" },
      {
        typescript: "~5.8.3",
        "@types/react": "^19.0.0",
        "@warlock.js/tests": "5.2.0",
      },
    );

    expect(execSync).toHaveBeenNthCalledWith(
      1,
      "npm install react@^19.2.3",
      expect.objectContaining({ cwd: process.cwd(), stdio: "inherit" }),
    );
    expect(execSync).toHaveBeenNthCalledWith(
      2,
      "npm install --save-exact @warlock.js/web@5.2.0",
      expect.objectContaining({ cwd: process.cwd(), stdio: "inherit" }),
    );
    expect(execSync).toHaveBeenNthCalledWith(
      3,
      "npm install typescript@~5.8.3 @types/react@^19.0.0 -D",
      expect.objectContaining({ cwd: process.cwd(), stdio: "inherit" }),
    );
    expect(execSync).toHaveBeenNthCalledWith(
      4,
      "npm install --save-exact @warlock.js/tests@5.2.0 -D",
      expect.objectContaining({ cwd: process.cwd(), stdio: "inherit" }),
    );
  });
});
