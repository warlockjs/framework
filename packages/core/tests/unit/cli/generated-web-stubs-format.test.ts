import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";

import {
  webContactControllerStub,
  webContactRoutesStub,
  webHomePageStub,
  webHomeRegisterStub,
  webRootStub,
} from "../../../src/generations/stubs";

/**
 * `warlock add web` failed a fresh scaffold's OWN lint gate: the dev
 * server's health checker reported 12 `prettier/prettier` ESLint errors, all
 * inside files `warlock add web` itself generated (`src/web/root.tsx`,
 * `src/web/index.page.tsx`, `src/app/contact/controllers/contact.controller.ts`).
 * A developer's very first `lint` run failed on code they never wrote.
 *
 * This reads the scaffold's REAL `.prettierrc.json` off disk — not a
 * duplicated copy — so the assertion tracks the template. If the template's
 * formatting rules change, this test re-verifies against the new rules
 * automatically instead of silently drifting out of sync with them.
 */
const require = createRequire(import.meta.url);

const CREATE_WARLOCK_DIR = path.resolve(__dirname, "../../../../create-warlock");

const TEMPLATE_PRETTIERRC = path.resolve(CREATE_WARLOCK_DIR, "templates/warlock/.prettierrc.json");

const scaffoldPrettierConfig = JSON.parse(readFileSync(TEMPLATE_PRETTIERRC, "utf8")) as {
  plugins?: string[];
  [key: string]: unknown;
};

/**
 * The scaffold's config names its plugin by bare specifier
 * (`"@ianvs/prettier-plugin-sort-imports"`), which only resolves relative to
 * `create-warlock`'s own `node_modules` (it is not a dependency of `core`).
 * Resolve it explicitly rather than letting `prettier.format` fail to find
 * it — a plugin that silently fails to load would make this test pass for
 * the wrong reason (no import-order errors would ever be caught).
 */
const resolvedPlugins = (scaffoldPrettierConfig.plugins ?? []).map((pluginName) =>
  require.resolve(pluginName, { paths: [CREATE_WARLOCK_DIR] }),
);

const prettierOptions = {
  ...scaffoldPrettierConfig,
  plugins: resolvedPlugins,
};

type StubCase = {
  readonly writtenAs: string;
  readonly content: string;
  readonly filepath: string;
};

/**
 * Every file `warlock add web`'s `completeWebInstallation` writes (see
 * `src/generations/features/web.feature.ts`), paired with the stub that
 * supplies its content and the extension prettier needs to pick the right
 * parser.
 */
const generatedWebStubs: readonly StubCase[] = [
  { writtenAs: "src/web/root.tsx", content: webRootStub, filepath: "root.tsx" },
  { writtenAs: "src/web/index.page.tsx", content: webHomePageStub, filepath: "index.page.tsx" },
  {
    writtenAs: "src/web/index.register.ts",
    content: webHomeRegisterStub,
    filepath: "index.register.ts",
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

describe("@ianvs/prettier-plugin-sort-imports actually loads for this config", () => {
  it("reorders imports with the plugin while the no-plugin control preserves the wrong order", async () => {
    const imports = [
      'import { local } from "./local";',
      'import { user } from "app/users";',
      'import { shared } from "@shared/utils";',
      'import { page } from "web/page";',
      'import { Head, Scripts } from "@warlock.js/web";',
      'import type { AppProps } from "@warlock.js/web";',
      'import path from "node:path";',
    ];
    const misordered = imports.join("\n") + "\n";
    const options = { ...prettierOptions, filepath: "root.tsx" };
    const withoutPlugin = await prettier.format(misordered, { ...options, plugins: [] });
    expect(withoutPlugin).toBe(misordered);

    const formatted = await prettier.format(misordered, options);
    expect(formatted.trim().split("\n")).toEqual([
      imports[6],
      imports[4],
      imports[5],
      imports[2],
      imports[1],
      imports[3],
      imports[0],
    ]);
    // Sorting retains unused bindings and separate type imports. The linter
    // owns unused-import diagnostics, independently of the formatter.
    expect(await prettier.format(formatted, options)).toBe(formatted);
  });

  it("sorts imports in files with stage-3 decorators without silently skipping them", async () => {
    const source =
      'import { z } from "z-package";\n' +
      'import { a } from "a-package";\n' +
      "\n@a\nexport class Example {\n  value = z;\n}\n";
    const formatted = await prettier.format(source, { ...prettierOptions, filepath: "model.ts" });
    expect(formatted.indexOf('from "a-package"')).toBeLessThan(
      formatted.indexOf('from "z-package"'),
    );
    expect(formatted).toContain("@a");
  });

  it("webRootStub already has its two imports in the plugin's preferred order", () => {
    expect(webRootStub.indexOf('import type { AppProps } from "@warlock.js/web"')).toBeLessThan(
      webRootStub.indexOf('import { Head, Scripts } from "@warlock.js/web"'),
    );
  });
});

describe("every file `warlock add web` generates is already prettier-formatted", () => {
  for (const stub of generatedWebStubs) {
    it(`${stub.writtenAs}: a developer's first lint run must not fail on this generated file`, async () => {
      const formatted = await prettier.format(stub.content, {
        ...prettierOptions,
        filepath: stub.filepath,
      });

      expect(stub.content).toBe(formatted);
    });
  }
});
