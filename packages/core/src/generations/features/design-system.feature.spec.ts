import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCommandAction } from "../add-command.action";
import payload from "../design-system-payload.json" with { type: "json" };
import { runGenerationCommand } from "../generation-run";

let originalCwd: string;
let directory: string;
const manifest = JSON.stringify({
  name: "example",
  dependencies: {},
  devDependencies: { tailwindcss: "4.1.16" },
});

beforeEach(async () => {
  originalCwd = process.cwd();
  directory = await mkdtemp(path.join(os.tmpdir(), "warlock-design-system-"));
  process.chdir(directory);
  await writeFile("package.json", manifest);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  process.chdir(originalCwd);
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function tailwind() {
  await mkdir("src/web", { recursive: true });
  await writeFile("src/web/root.tsx", "export default function Root() { return null; }\n");
  await writeFile("src/web/app.css", '@import "tailwindcss";\n');
  await writeFile("tsconfig.json", '{ "compilerOptions": {} }');
}

describe("warlock add design-system", () => {
  it("refuses before touching the manifest when Tailwind is not configured", async () => {
    await expect(
      addCommandAction({ args: ["design-system"], options: { noInstall: true } }),
    ).rejects.toThrow("warlock add tailwind");
    expect(await readFile("package.json", "utf8")).toBe(manifest);
    expect(existsSync("src")).toBe(false);
  });

  it("does not treat a commented Tailwind import as a configured stylesheet", async () => {
    await tailwind();
    await writeFile("src/web/app.css", '/* @import "tailwindcss"; */');
    await expect(
      addCommandAction({ args: ["design-system"], options: { noInstall: true } }),
    ).rejects.toThrow("warlock add tailwind");
    expect(await readFile("package.json", "utf8")).toBe(manifest);
    expect(existsSync("src/web/design-system")).toBe(false);
  });

  it("writes the shared payload and dependencies while preserving existing controls", async () => {
    await tailwind();
    const preserved = "src/web/design-system/components/text-input.tsx";
    await mkdir(path.dirname(preserved), { recursive: true });
    await writeFile(preserved, "// customized\n");
    await addCommandAction({ args: ["design-system"], options: { noInstall: true } });
    expect(await readFile(preserved, "utf8")).toBe("// customized\n");
    for (const [file, content] of Object.entries(payload.files)) {
      if (file !== preserved) expect(await readFile(file, "utf8")).toBe(content);
    }
    const result = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(result.dependencies).toMatchObject(payload.dependencies);
    expect(existsSync("components.json")).toBe(true);
  });

  it("previews without writing source, styles, configuration or dependencies", async () => {
    await tailwind();
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runGenerationCommand(
      "add",
      { args: ["design-system"], options: { dryRun: true, json: true } },
      addCommandAction,
    );
    expect(await readFile("package.json", "utf8")).toBe(manifest);
    expect(await readFile("src/web/app.css", "utf8")).toBe('@import "tailwindcss";\n');
    expect(existsSync("src/web/design-system")).toBe(false);
    expect(existsSync("components.json")).toBe(false);
    expect(stdout).toHaveBeenCalled();
  });
});
