import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCommandAction } from "../add-command.action";
import mantinePayload from "../design-system-mantine-payload.json" with { type: "json" };
import shadcnPayload from "../design-system-payload.json" with { type: "json" };
import { runGenerationCommand } from "../generation-run";
import { webRootStub } from "../stubs";
import { resolveUiKitFeatures } from "./shared/ui-kit";

let originalCwd: string;
let directory: string;
const bareManifest = JSON.stringify({ name: "example", dependencies: {}, devDependencies: {} });

beforeEach(async () => {
  originalCwd = process.cwd();
  directory = await mkdtemp(path.join(os.tmpdir(), "warlock-mantine-"));
  process.chdir(directory);
  await writeFile("package.json", bareManifest);
  await writeFile("tsconfig.json", '{ "compilerOptions": {} }');
  await mkdir("src/web", { recursive: true });
  await writeFile("src/web/root.tsx", webRootStub);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  process.chdir(originalCwd);
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const add = (args: string[], options: Record<string, unknown> = {}) =>
  addCommandAction({ args, options: { noInstall: true, ...options } });
const manifest = async () =>
  JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

describe("warlock add design-system --kit mantine", () => {
  it("does not require Tailwind and writes the contract files and dependencies", async () => {
    await add(["design-system"], { kit: "mantine" });
    for (const [file, content] of Object.entries(mantinePayload.files)) {
      expect(await readFile(file, "utf8")).toBe(content);
    }
    const result = await manifest();
    expect(result.dependencies).toMatchObject(mantinePayload.dependencies);
    expect(result.devDependencies).toMatchObject(mantinePayload.devDependencies);
    expect(result.devDependencies.tailwindcss).toBeUndefined();
    // Nothing from the shadcn kit.
    expect(existsSync("components.json")).toBe(false);
    expect(existsSync("src/web/components/ui")).toBe(false);
    for (const dependency of Object.keys(shadcnPayload.dependencies)) {
      if (dependency === "@mongez/react-form") continue;
      expect(result.dependencies[dependency]).toBeUndefined();
    }
    expect(result.dependencies["@mantine/form"]).toBeUndefined();
  });

  it("pins exact versions and ships every contract component", async () => {
    for (const version of [
      ...Object.values(mantinePayload.dependencies),
      ...Object.values(mantinePayload.devDependencies),
    ])
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const name of [
      "text-input",
      "email-input",
      "password-input",
      "textarea-input",
      "select-input",
      "multi-select-input",
      "checkbox-input",
      "radio-input",
      "switch-input",
      "date-picker-input",
      "date-time-picker-input",
      "time-picker-input",
      "file-input",
      "field-frame",
      "submit-button",
    ])
      expect(mantinePayload.files).toHaveProperty([`src/web/design-system/components/${name}.tsx`]);
    for (const name of [
      "use-control",
      "use-date-control",
      "use-file-control",
      "use-select-control",
      "use-submit-control",
    ])
      expect(mantinePayload.files).toHaveProperty([`src/web/design-system/hooks/${name}.ts`]);
  });

  it("wires PostCSS, the stylesheet and the SSR root", async () => {
    await add(["design-system"], { kit: "mantine" });
    expect(await readFile("postcss.config.mjs", "utf8")).toContain("postcss-preset-mantine");
    const css = await readFile("src/web/app.css", "utf8");
    expect(css).toContain('@import "@mantine/core/styles.css";');
    expect(css).toContain('@import "@mantine/dates/styles.css";');
    expect(css).toContain('@import "@mantine/notifications/styles.css";');
    const root = await readFile("src/web/root.tsx", "utf8");
    expect(root).toContain('import "./app.css";');
    expect(root).toContain('import { mantineHtmlProps } from "@mantine/core";');
    expect(root).toContain('<html lang="en" {...mantineHtmlProps}>');
    expect(root).toContain("<DesignSystemColorScheme />");
    expect(root).toMatch(
      /<DesignSystemProvider>\s*<div id="vessel">\{children\}<\/div>\s*<\/DesignSystemProvider>/,
    );
    // The imports sit after the framework import, not inside the component.
    expect(root.indexOf("DesignSystemProvider, {")).toBeLessThan(root.indexOf("export default"));
  });

  it("is the same install as `warlock add mantine`, and is idempotent", async () => {
    await add(["mantine"]);
    const first = {
      root: await readFile("src/web/root.tsx", "utf8"),
      css: await readFile("src/web/app.css", "utf8"),
      manifest: await readFile("package.json", "utf8"),
    };
    expect((await manifest()).dependencies["@mantine/core"]).toBe(
      mantinePayload.dependencies["@mantine/core"],
    );
    await add(["design-system"], { kit: "mantine" });
    expect(await readFile("src/web/root.tsx", "utf8")).toBe(first.root);
    expect(await readFile("src/web/app.css", "utf8")).toBe(first.css);
    expect(await readFile("package.json", "utf8")).toBe(first.manifest);
  });

  it("keeps an existing stylesheet, PostCSS config and customised controls", async () => {
    await writeFile("src/web/app.css", "body { color: red; }\n");
    await writeFile("postcss.config.mjs", "export default { plugins: { autoprefixer: {} } };\n");
    const preserved = "src/web/design-system/components/text-input.tsx";
    await mkdir(path.dirname(preserved), { recursive: true });
    await writeFile(preserved, "// customized\n");
    await add(["mantine"]);
    expect(await readFile("src/web/app.css", "utf8")).toMatch(
      /^@import "@mantine\/core\/styles\.css";[\s\S]*body \{ color: red; \}\n$/,
    );
    expect(await readFile("postcss.config.mjs", "utf8")).toBe(
      "export default { plugins: { autoprefixer: {} } };\n",
    );
    expect(await readFile(preserved, "utf8")).toBe("// customized\n");
  });

  it("leaves a custom root alone and prints the manual steps", async () => {
    const custom = "export default function Root() { return null; }\n";
    await writeFile("src/web/root.tsx", custom);
    await add(["mantine"]);
    expect(await readFile("src/web/root.tsx", "utf8")).toBe(custom);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("wire Mantine into");
  });

  it("works next to an existing Tailwind setup without touching it", async () => {
    await writeFile("src/web/app.css", '@import "tailwindcss";\n');
    await add(["mantine"]);
    const css = await readFile("src/web/app.css", "utf8");
    expect(css).toContain('@import "tailwindcss";');
    expect(css.indexOf("@mantine/core")).toBeLessThan(css.indexOf("tailwindcss"));
  });

  it("refuses when the shadcn kit is installed, by files or by dependencies, and writes nothing", async () => {
    await writeFile("components.json", "{}");
    const before = await readFile("package.json", "utf8");
    await expect(add(["design-system"], { kit: "mantine" })).rejects.toThrow(
      /shadcn design-system kit is already installed[\s\S]*warlock add design-system --kit mantine/,
    );
    expect(await readFile("package.json", "utf8")).toBe(before);
    expect(existsSync("src/web/design-system")).toBe(false);

    await rm("components.json");
    await writeFile(
      "package.json",
      JSON.stringify({ dependencies: { "radix-ui": "1.7.0" }, devDependencies: {} }),
    );
    await expect(add(["mantine"])).rejects.toThrow("already installed");
  });

  it("refuses the default shadcn kit when Mantine is installed", async () => {
    await add(["mantine"]);
    const before = await readFile("package.json", "utf8");
    await expect(add(["design-system"])).rejects.toThrow(
      /mantine design-system kit is already installed[\s\S]*--kit shadcn/,
    );
    await expect(add(["shadcn"])).rejects.toThrow("already installed");
    expect(await readFile("package.json", "utf8")).toBe(before);
    expect(existsSync("components.json")).toBe(false);
  });

  it("refuses both kits in one command and unknown kits", async () => {
    await expect(add(["design-system", "shadcn"], { kit: "mantine" })).rejects.toThrow(
      "exclude each other",
    );
    await expect(add(["mantine", "design-system"])).rejects.toThrow("exclude each other");
    await expect(add(["design-system"], { kit: "chakra" })).rejects.toThrow(
      'Unknown design-system kit "chakra"',
    );
    await expect(add(["mantine"], { kit: "mantine" })).rejects.toThrow("--kit only applies");
    expect(await readFile("package.json", "utf8")).toBe(bareManifest);
  });

  it("previews without writing anything", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const root = await readFile("src/web/root.tsx", "utf8");
    await runGenerationCommand(
      "add",
      { args: ["design-system"], options: { kit: "mantine", dryRun: true, json: true } },
      addCommandAction,
    );
    expect(await readFile("package.json", "utf8")).toBe(bareManifest);
    expect(await readFile("src/web/root.tsx", "utf8")).toBe(root);
    expect(existsSync("src/web/design-system")).toBe(false);
    expect(existsSync("postcss.config.mjs")).toBe(false);
    expect(stdout).toHaveBeenCalled();
  });
});

describe("resolveUiKitFeatures", () => {
  it("rewrites design-system to mantine only for --kit mantine", () => {
    expect(resolveUiKitFeatures(["design-system"], undefined)).toEqual(["design-system"]);
    expect(resolveUiKitFeatures(["design-system"], "shadcn")).toEqual(["design-system"]);
    expect(resolveUiKitFeatures(["web", "design-system"], "mantine")).toEqual(["web", "mantine"]);
  });
});
