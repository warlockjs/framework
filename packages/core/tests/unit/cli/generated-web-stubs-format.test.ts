import { readFileSync } from "node:fs";
import path from "node:path";
import { format } from "oxfmt";
import { describe, expect, it } from "vitest";
import {
  webContactControllerStub,
  webContactRoutesStub,
  webHomePageStub,
  webHomeSetupStub,
  webRootStub,
  webRootSetupStub,
} from "../../../src/generations/stubs";

const options = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../../../create-warlock/templates/toolchains/oxc/.oxfmtrc.json"),
    "utf8",
  ),
);

type StubCase = {
  readonly writtenAs: string;
  readonly content: string;
  readonly filepath: string;
};

/**
 * Every file `warlock add web`'s `completeWebInstallation` writes (see
 * `src/generations/features/web.feature.ts`), paired with the stub that
 * supplies its content and the extension Oxfmt needs to pick the right
 * parser.
 */
const generatedWebStubs: readonly StubCase[] = [
  { writtenAs: "src/web/root.tsx", content: webRootStub, filepath: "root.tsx" },
  { writtenAs: "src/web/root.setup.ts", content: webRootSetupStub, filepath: "root.setup.ts" },
  { writtenAs: "src/web/index.page.tsx", content: webHomePageStub, filepath: "index.page.tsx" },
  {
    writtenAs: "src/web/index.setup.ts",
    content: webHomeSetupStub,
    filepath: "index.setup.ts",
  },
  {
    writtenAs: "src/app/contact/controllers/contact.controller.ts",
    content: webContactControllerStub,
    filepath: "contact.controller.ts",
  },
  {
    writtenAs: "src/app/contact/routes.ts",
    content: webContactRoutesStub,
    filepath: "routes.ts",
  },
];

describe("generated web source matches the scaffold's Oxfmt config", () => {
  for (const stub of generatedWebStubs) {
    it(stub.writtenAs, async () => {
      const result = await format(stub.filepath, stub.content, options);
      expect(result.errors).toEqual([]);
      expect(result.code).toBe(stub.content);
    });
  }
  it("sorts built-ins, packages, aliases and relative imports", async () => {
    const source =
      'import { local } from "./local";\nimport { item } from "app/items";\nimport { Head } from "@warlock.js/web";\nimport path from "node:path";\n';
    const result = await format("root.tsx", source, options);
    expect(result.errors).toEqual([]);
    expect(result.code.indexOf('from "node:path"')).toBeLessThan(
      result.code.indexOf('from "@warlock.js/web"'),
    );
    expect(result.code.indexOf('from "app/items"')).toBeLessThan(
      result.code.indexOf('from "./local"'),
    );
  });
});
