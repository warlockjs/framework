import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveNonInteractiveOptions } from "../src/commands/create-new-app";
import { features } from "../src/features/features-map";

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates");
const root = path.join(templates, "design-system-mantine");
const shadcnRoot = path.join(templates, "design-system");
const components = [
  "TextInput",
  "EmailInput",
  "PasswordInput",
  "TextareaInput",
  "SelectInput",
  "MultiSelectInput",
  "DatePickerInput",
  "TimePickerInput",
  "DateTimePickerInput",
  "CheckboxInput",
  "RadioInput",
  "SwitchInput",
  "FileInput",
  "SubmitButton",
];
const read = (file: string, base = root) => readFileSync(path.join(base, file), "utf8");
function list(base: string, directory: string): string[] {
  return readdirSync(path.join(base, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? list(base, `${directory}/${entry.name}`) : [`${directory}/${entry.name}`],
  );
}

describe("optional Mantine design system template", () => {
  it.each(components)("ships %s as a default export in the same file as the shadcn kit", (name) => {
    const slug = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).slice(1);
    const file = `src/web/design-system/components/${slug}.tsx`;
    const source = read(file);
    expect(source).toContain(`export default function ${name}(`);
    expect(source).not.toMatch(/useState|useEffect|<select\b|type="(?:checkbox|radio|date)"/);
    expect(source).toContain("../hooks/");
    expect(source).toContain("@mantine/");
    // Same props contract, same file name as the shadcn kit.
    expect(read(file, shadcnRoot)).toContain(`export default function ${name}(`);
  });

  it("shares the kit-agnostic hooks and prop types byte for byte with the shadcn kit", () => {
    const shared = [
      ...list(root, "src/web/design-system/hooks"),
      ...list(root, "src/web/design-system/types"),
    ];
    expect(shared.length).toBeGreaterThanOrEqual(6);
    for (const file of shared) expect(read(file)).toBe(read(file, shadcnRoot));
  });

  it("keeps the payload byte-for-byte aligned with every Mantine source file", () => {
    const payload = JSON.parse(
      readFileSync(
        path.resolve(templates, "../../core/src/generations/design-system-mantine-payload.json"),
        "utf8",
      ),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      files: Record<string, string>;
    };
    const files: Record<string, string> = {};
    for (const file of list(root, "src")) files[file] = read(file);
    expect(payload.files).toEqual(files);
    const manifest = JSON.parse(read("package.json")) as typeof payload;
    expect(payload.dependencies).toEqual(manifest.dependencies);
    expect(payload.devDependencies).toEqual(manifest.devDependencies);
    for (const version of [
      ...Object.values(manifest.dependencies),
      ...Object.values(manifest.devDependencies),
    ])
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("uses Mongez React Form and never installs or imports @mantine/form", () => {
    const manifest = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["@mongez/react-form"]).toBeDefined();
    expect(JSON.stringify(manifest)).not.toContain("@mantine/form");
    for (const file of list(root, "src")) expect(read(file)).not.toContain("@mantine/form");
    expect(read("src/web/design-system/hooks/use-control.ts")).toContain("useFormControl");
  });

  it("pins every @mantine package to one version", () => {
    const manifest = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    const versions = new Set(
      Object.entries(manifest.dependencies)
        .filter(([name]) => name.startsWith("@mantine/"))
        .map(([, version]) => version),
    );
    expect([...versions]).toHaveLength(1);
  });

  it("mounts the provider, colour scheme script, notifications and modals", () => {
    const provider = read("src/web/design-system/provider.tsx");
    for (const part of ["MantineProvider", "ModalsProvider", "Notifications", "ColorSchemeScript"])
      expect(provider).toContain(part);
    expect(read("src/web/design-system/mantine-theme.ts")).toContain("primaryColor");
  });

  it("offers the feature and the --ui choice, and keeps the kits exclusive", () => {
    expect(features.some((feature) => feature.key === "mantine")).toBe(true);
    expect(
      resolveNonInteractiveOptions({ name: "x", stack: "web", ui: "mantine" }).features,
    ).toEqual(["web", "mantine"]);
    expect(resolveNonInteractiveOptions({ name: "x", stack: "web", ui: "none" }).features).toEqual([
      "web",
    ]);
    expect(
      resolveNonInteractiveOptions({ name: "x", stack: "web", ui: "shadcn" }).features,
    ).toEqual(["web", "shadcn", "design-system"]);
    expect(resolveNonInteractiveOptions({ name: "x", features: ["mantine"] }).features).toEqual([
      "mantine",
    ]);
    expect(
      resolveNonInteractiveOptions({ name: "x", features: ["web"], ui: "mantine" }).features,
    ).toEqual(["web", "mantine"]);
    expect(() =>
      resolveNonInteractiveOptions({ name: "x", features: ["shadcn", "mantine"] }),
    ).toThrow("exclude each other");
    expect(() =>
      resolveNonInteractiveOptions({ name: "x", features: ["shadcn"], ui: "mantine" }),
    ).toThrow("conflicts");
    expect(() =>
      resolveNonInteractiveOptions({ name: "x", features: ["mantine"], ui: "none" }),
    ).toThrow("conflicts");
    expect(() => resolveNonInteractiveOptions({ name: "x", ui: "chakra" })).toThrow("Unknown --ui");
  });
});
