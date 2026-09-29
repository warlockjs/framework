import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityFixture } from "./__fixtures__/identity-fixture";
import { importAppModule, setAppModuleImporter } from "./app-module-importer";

const fixtureUrl = pathToFileURL(
  new URL("./__fixtures__/identity-fixture.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
).href;

describe("importAppModule class identity under Vitest", () => {
  afterEach(() => {
    setAppModuleImporter(undefined);
  });

  it("returns the same class the test file imported when the hook is `(file) => import(file)`", async () => {
    setAppModuleImporter((file) => import(/* @vite-ignore */ file));

    const loaded = await importAppModule(fixtureUrl);

    expect(loaded.IdentityFixture).toBe(IdentityFixture);
    expect(new loaded.IdentityFixture()).toBeInstanceOf(IdentityFixture);
  });

  // No native-path control here: when this spec imports app-module-importer.ts through vite-node, the
  // importer's own `import(fileUrl)` is transformed too and returns the SAME class, so it cannot
  // demonstrate the two-copies bug in-process. The bug only shows when the framework runs natively.
});
