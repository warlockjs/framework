import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tsconfigManager } from "../../../../dev-server/tsconfig-manager";
import type { DoctorBootContext } from "../check.types";
import { configAppImportsCheck, findConfigAppImports } from "./config-app-imports.check";

let root: string;

function write(relative: string, contents: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-config-imports-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  tsconfigManager.tsconfig = undefined;
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "app/*": ["src/app/*"] } } }),
  );
  write("src/app/orders/tracker.service.ts", "export const track = () => 1;\n");
  write("src/app/orders/types.ts", "export type Order = { id: string };\n");
});

afterEach(() => {
  vi.restoreAllMocks();
  tsconfigManager.tsconfig = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("config-app-imports doctor check", () => {
  it("names the config file and the import for a static import of app code", async () => {
    write(
      "src/config/web.ts",
      'import { track } from "../app/orders/tracker.service";\nexport default { errors: { report: track } };\n',
    );

    expect(await findConfigAppImports()).toEqual([
      { file: "src/config/web.ts", specifier: "../app/orders/tracker.service" },
    ]);
  });

  it("also catches a lazy import() and an alias import", async () => {
    write(
      "src/config/web.ts",
      [
        "export default { errors: { report: async () => {",
        '  const { track } = await import("app/orders/tracker.service");',
        "  track();",
        "} } };",
        "",
      ].join("\n"),
    );

    expect(await findConfigAppImports()).toEqual([
      { file: "src/config/web.ts", specifier: "app/orders/tracker.service" },
    ]);

    const result = await configAppImportsCheck.run({} as DoctorBootContext);

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain('src/config/web.ts imports "app/orders/tracker.service"');
    expect(result?.detail).toContain("onPageError()");
  });

  it("stays silent for type-only imports, packages and a config that imports nothing local", async () => {
    write(
      "src/config/web.ts",
      'import type { Order } from "../app/orders/types";\nimport { env } from "@warlock.js/core";\nexport default { x: env("X") as unknown as Order };\n',
    );

    expect(await findConfigAppImports()).toEqual([]);
    expect(await configAppImportsCheck.run({} as DoctorBootContext)).toBeUndefined();
  });
});
