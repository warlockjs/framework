import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { featuresMap } from "./index";

/**
 * The starter template (`packages/create-warlock/templates/warlock`) pins its
 * own copies of some dependencies. `warlock add <feature>` keeps those pins
 * (it never overwrites a dependency the project already declares), so a
 * feature that adds a package peering on one of them must add it at the same
 * version — otherwise npm resolves two copies of the peer and can crash.
 */
const TEMPLATE_PEERS: Record<string, string> = {
  "@vitest/coverage-v8": "vitest",
  "@vitest/coverage-istanbul": "vitest",
  "@vitest/ui": "vitest",
  "@mongez/react-localization": "@mongez/localization",
};

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const template: PackageManifest = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../../create-warlock/templates/warlock/package.json", import.meta.url),
    ),
    "utf8",
  ),
);

function templatePin(name: string): string | undefined {
  return template.dependencies?.[name] ?? template.devDependencies?.[name];
}

describe("feature dependencies against the starter template pins", () => {
  it("adds every peer of a template dependency at the template's exact version", () => {
    const checked: string[] = [];

    for (const [featureName, feature] of Object.entries(featuresMap)) {
      const added = { ...feature.dependencies, ...feature.devDependencies };

      for (const [name, range] of Object.entries(added)) {
        const peerOf = TEMPLATE_PEERS[name];

        if (!peerOf) continue;

        const pin = templatePin(peerOf);

        expect(pin, `template does not pin ${peerOf} (needed by ${featureName})`).toBeDefined();
        expect(range, `${featureName} adds ${name} at ${range}, template pins ${peerOf} at ${pin}`).toBe(
          pin,
        );

        checked.push(`${featureName}:${name}`);
      }
    }

    // Guard against a vacuous pass: the test feature alone adds two checked packages.
    expect(checked).toEqual(
      expect.arrayContaining(["test:@vitest/coverage-v8", "web:@mongez/react-localization"]),
    );
  });

  it("keeps the template's vitest pin in step with the test feature's own vitest", () => {
    expect(featuresMap.test.devDependencies?.vitest).toBe(templatePin("vitest"));
  });
});
