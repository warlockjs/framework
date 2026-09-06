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

const TEMPLATE_PRETTIERRC = path.resolve(
  CREATE_WARLOCK_DIR,
  "templates/warlock/.prettierrc.json",
);

const scaffoldPrettierConfig = JSON.parse(readFileSync(TEMPLATE_PRETTIERRC, "utf8")) as {
  plugins?: string[];
  [key: string]: unknown;
};

/**
 * The scaffold's config names its plugin by bare specifier
 * (`"prettier-plugin-organize-imports"`), which only resolves relative to
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

describe("prettier-plugin-organize-imports actually loads for this config", () => {
  it("reorders a deliberately-misordered pair of imports, proving the plugin ran (not merely was listed)", async () => {
    // `prettier-plugin-organize-imports` also drops unused imports, so both
    // bindings must actually be referenced or it would strip them instead of
    // reordering them and the assertion below would prove nothing.
    const misordered =
      'import { Head, Scripts } from "@warlock.js/web";\n' +
      'import type { AppProps } from "@warlock.js/web";\n' +
      "\n" +
      "export function App({ children }: AppProps) {\n" +
      "  return (\n" +
      "    <>\n" +
      "      <Head />\n" +
      "      {children}\n" +
      "      <Scripts />\n" +
      "    </>\n" +
      "  );\n" +
      "}\n";

    const formatted = await prettier.format(misordered, {
      ...prettierOptions,
      filepath: "root.tsx",
    });

    // The plugin puts the `import type` line before the value import — bare
    // `prettier.format` with no plugins would leave the input order alone.
    expect(formatted.indexOf("import type { AppProps }")).toBeLessThan(
      formatted.indexOf("import { Head, Scripts }"),
    );
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
