import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gateAResolve, isBrowserSafeModuleFile, moduleSurfaceOf } from "./gate-a-resolve";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Generated, not committed: these files exist only to be resolved. */
const ROOT = path.join(__dirname, "..", "..", "__tests__", "vite", "fixtures", "gate-a-modules");
const APP = path.join(ROOT, "src", "app");
const PAGE = path.join(ROOT, "src", "web", "entry.page.tsx");

function write(file: string, contents: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

async function buildPage(
  body: string,
  options: { moduleBoundary?: "error" | "warn" | "off" } = {},
  warnings: string[] = [],
  plugin: Plugin = gateAResolve({ appRoot: ROOT, ...options }),
) {
  write(PAGE, body);
  return build({
    root: ROOT,
    logLevel: "silent",
    resolve: {
      alias: [{ find: /^app\//, replacement: `${APP.replace(/\\/g, "/")}/` }],
    },
    plugins: [plugin],
    build: {
      write: false,
      minify: false,
      lib: { entry: PAGE, formats: ["es"], fileName: () => "out.js" },
      rollupOptions: {
        external: [],
        onwarn: (warning) => warnings.push(warning.message),
      },
    },
  });
}

function code(result: Awaited<ReturnType<typeof buildPage>>): string {
  const output = Array.isArray(result) ? result[0] : result;
  const chunk = "output" in output ? output.output[0] : undefined;
  if (!chunk || chunk.type !== "chunk") throw new Error("expected a JS chunk");
  return chunk.code;
}

const ERROR = { moduleBoundary: "error" } as const;

const SERVICE_IMPORT = `import { createUser } from "app/users/services/create-user.service";\nexport default createUser();\n`;

beforeAll(() => {
  write(
    path.join(ROOT, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true, jsx: "preserve" } })}\n`,
  );
  write(
    path.join(APP, "users", "services", "create-user.service.ts"),
    `export type CreateUserInput = { name: string };\nexport const createUser = () => "server-value";\n`,
  );
  write(
    path.join(APP, "users", "schema", "create-user.schema.ts"),
    `export const schemaValue = "schema-value";\n`,
  );
  write(
    path.join(APP, "users", "schema", "browser.ts"),
    `export const browserValue = "browser-value";\n`,
  );
  write(path.join(APP, "users", "types", "user.ts"), `export const typesValue = "types-value";\n`);
  write(
    path.join(APP, "users", "format.client.ts"),
    `export const clientValue = "client-value";\n`,
  );
  write(path.join(APP, "users", "web", "badge.ts"), `export const webValue = "web-value";\n`);
  write(path.join(APP, "users", "locales.json"), `{ "title": { "en": "Users" } }\n`);
  write(path.join(APP, "users", "enums.ts"), `export const enumValue = "enum-value";\n`);
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("moduleSurfaceOf / isBrowserSafeModuleFile", () => {
  it("splits a path under <srcDir>/app/<module>/ and nothing else", () => {
    const file = path.join(APP, "users", "services", "create-user.service.ts");
    expect(moduleSurfaceOf(file, ROOT)).toEqual({
      module: "users",
      inner: "services/create-user.service.ts",
    });
    expect(moduleSurfaceOf(path.join(ROOT, "src", "web", "entry.page.tsx"), ROOT)).toBeUndefined();
    expect(moduleSurfaceOf(path.join(APP, "main.ts"), ROOT)).toBeUndefined();
    expect(moduleSurfaceOf(file, ROOT, "lib")).toBeUndefined();
  });

  it("names the browser-safe surface of a module", () => {
    for (const inner of [
      "format.client.ts",
      "widgets/chart.client.tsx",
      "schema/create-user.schema.ts",
      "create-user.schema.ts",
      "schema/browser.ts",
      "types/user.ts",
      "user.types.ts",
      "user.d.ts",
      "web/badge.ts",
      "locales.json",
    ]) {
      expect(isBrowserSafeModuleFile(inner), inner).toBe(true);
    }
  });

  it("refuses the server surface of a module", () => {
    for (const inner of [
      "services/create-user.service.ts",
      "controllers/list-users.controller.ts",
      "repositories/users.repository.ts",
      "models/user.model.ts",
      "routes.ts",
      "enums.ts",
    ]) {
      expect(isBrowserSafeModuleFile(inner), inner).toBe(false);
    }
  });
});

describe("gateAResolve — module boundary (real Vite builds)", () => {
  it("refuses an alias-form value import of a service, naming the chain", async () => {
    await expect(buildPage(SERVICE_IMPORT, ERROR)).rejects.toThrow(
      /Import chain: entry\.page\.tsx → app\/users\/services\/create-user\.service/,
    );
  });

  it("explains the cause and the fix", async () => {
    try {
      await buildPage(SERVICE_IMPORT, ERROR);
      expect.unreachable("expected the build to fail");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('server file of module "users"');
      expect(message).toContain("*.client.ts(x)");
      expect(message).toContain("Fix:");
    }
  });

  it("refuses a relative import of a module file that is not browser-safe", async () => {
    await expect(
      buildPage(
        `import { enumValue } from "../app/users/enums";\nexport default enumValue;\n`,
        ERROR,
      ),
    ).rejects.toThrow(/server file of module "users"/);
  });

  it("admits .client, schema, types and web files and non-code files", async () => {
    const result = await buildPage(
      [
        `import { clientValue } from "app/users/format.client";`,
        `import { schemaValue } from "app/users/schema/create-user.schema";`,
        `import { browserValue } from "app/users/schema/browser";`,
        `import { typesValue } from "app/users/types/user";`,
        `import { webValue } from "app/users/web/badge";`,
        `import locales from "app/users/locales.json";`,
        `export default [clientValue, schemaValue, browserValue, typesValue, webValue, locales];`,
        ``,
      ].join("\n"),
    );
    const output = code(result);
    for (const value of [
      "client-value",
      "schema-value",
      "browser-value",
      "types-value",
      "web-value",
    ]) {
      expect(output).toContain(value);
    }
  });

  it("erases a type-only import of a service instead of refusing it", async () => {
    const result = await buildPage(
      [
        `import { type CreateUserInput } from "app/users/services/create-user.service";`,
        `export default (input: CreateUserInput) => input.name;`,
        ``,
      ].join("\n"),
    );
    expect(code(result)).not.toContain("server-value");
  });

  it("prints a repeated warn-mode violation once per session, then a count", async () => {
    const warnings: string[] = [];
    const plugin = gateAResolve({ appRoot: ROOT, moduleBoundary: "warn" });
    await buildPage(SERVICE_IMPORT, {}, warnings, plugin);
    await buildPage(SERVICE_IMPORT, {}, warnings, plugin);
    const printed = warnings.filter((message) => message.includes("WOULD refuse"));
    expect(printed).toHaveLength(1);
    expect(warnings.join("\n")).toContain("more boundary warning(s)");
  });

  it('reports instead of refusing when moduleBoundary is "warn"', async () => {
    const warnings: string[] = [];
    const result = await buildPage(SERVICE_IMPORT, { moduleBoundary: "warn" }, warnings);
    expect(code(result)).toContain("server-value");
    expect(warnings.join("\n")).toContain("web.moduleBoundary");
  });

  it("reports instead of refusing by default", async () => {
    const warnings: string[] = [];
    const result = await buildPage(SERVICE_IMPORT, {}, warnings);
    expect(code(result)).toContain("server-value");
    expect(warnings.join("\n")).toContain("web.moduleBoundary");
  });

  it('skips the rule when moduleBoundary is "off"', async () => {
    const result = await buildPage(SERVICE_IMPORT, { moduleBoundary: "off" });
    expect(code(result)).toContain("server-value");
  });
});
