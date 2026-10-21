import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveNonInteractiveOptions } from "../src/commands/create-new-app";
import { features } from "../src/features/features-map";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../templates/design-system",
);
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
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("optional design system template", () => {
  it.each(components)("ships %s as a default export in its own file", (name) => {
    const slug = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).slice(1);
    const source = read(`src/web/design-system/components/${slug}.tsx`);
    expect(source).toContain(`export default function ${name}(`);
    expect(source).not.toMatch(/useState|useEffect|<select\b|type="(?:checkbox|radio|date)"/);
    expect(source).toContain("../hooks/");
  });

  it("keeps the payload byte-for-byte aligned with every optional source file", () => {
    // Read Core as text to preserve the scaffolder's package isolation boundary.
    const generated = readFileSync(
      path.resolve(root, "../../../core/src/generations/design-system-payload.json"),
      "utf8",
    );
    const payload = JSON.parse(generated) as {
      dependencies: Record<string, string>;
      files: Record<string, string>;
    };
    const files: Record<string, string> = {};
    function visit(directory: string) {
      for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) visit(relative);
        else files[relative] = read(relative);
      }
    }
    visit("src");
    expect(payload.files).toEqual(files);
    const manifest = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(payload.dependencies).toEqual(manifest.dependencies);
    for (const version of Object.values(manifest.dependencies))
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("offers the feature and seeds full-stack and shadcn selections", () => {
    expect(features.some((feature) => feature.key === "design-system")).toBe(true);
    expect(resolveNonInteractiveOptions({ name: "example", stack: "web" }).features).toEqual([
      "web",
      "shadcn",
      "design-system",
    ]);
    expect(
      resolveNonInteractiveOptions({ name: "example", features: ["tailwind", "shadcn"] }).features,
    ).toEqual(["tailwind", "shadcn", "design-system"]);
    expect(resolveNonInteractiveOptions({ name: "example", stack: "api" }).features).not.toContain(
      "design-system",
    );
  });

  it("requires explicit ids and keeps focus and validation adapters in hooks", () => {
    expect(read("src/web/design-system/types/control-props.ts")).toContain("id: string");
    const hook = read("src/web/design-system/hooks/use-control.ts");
    expect(hook).toContain("useFormControl");
    expect(hook).toContain("visibleElementRef.current = element");
    expect(hook).toContain("`${props.id}-error`");
    expect(hook).toContain("`${props.id}-hint`");
    expect(read("src/web/design-system/components/radio-input.tsx")).toContain("useControl(props)");
  });
});
