import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CapabilityInfo } from "../../capabilities/capability";
import { collectWiring, wiringFilesFromScan } from "./collect-wiring";
import type { InspectFile } from "./inspect-report.types";

const cwd = path.resolve("/project");

function scanned(file: string, role: string): InspectFile {
  return { file, module: "", role, exports: [], imports: [], importedBy: [] };
}

describe("wiringFilesFromScan", () => {
  it("orders the roles as the boot loads them and routes by path", () => {
    const files = [
      scanned("src/app/shop/routes.ts", "routes"),
      scanned("src/app/posts/routes.ts", "routes"),
      scanned("src/app/posts/main.ts", "main"),
      scanned("src/app/posts/events/audit.ts", "event"),
      scanned("src/app/posts/utils/locales.ts", "locale"),
      scanned("src/config/http.ts", "config"),
      scanned("src/app/posts/services/publish.service.ts", "service"),
      scanned("src/app/posts/routes.spec.ts", "spec"),
    ];

    expect(wiringFilesFromScan(files).map((entry) => `${entry.role} ${entry.file}`)).toEqual([
      "config src/config/http.ts",
      "locale src/app/posts/utils/locales.ts",
      "event src/app/posts/events/audit.ts",
      "main src/app/posts/main.ts",
      "route src/app/posts/routes.ts",
      "route src/app/shop/routes.ts",
    ]);
  });
});

describe("collectWiring", () => {
  const slot = (overrides: Partial<CapabilityInfo> = {}): CapabilityInfo => ({
    name: "posts.notifier",
    description: "Tells followers",
    required: true,
    provided: true,
    definedIn: path.join(cwd, "src/app/posts/capabilities.ts"),
    providedBy: path.join(cwd, "src/app/posts/main.ts"),
    consumers: [path.join(cwd, "src/app/posts/services/b.service.ts"), path.join(cwd, "src/app/posts/services/a.service.ts")],
    ...overrides,
  });

  it("numbers files from 1 in the given order and names each one's module", () => {
    const wiring = collectWiring(
      cwd,
      [
        { role: "config", file: "src/config/http.ts" },
        { role: "main", file: "src/app/posts/main.ts" },
        { role: "route", file: path.join(cwd, "src/app/posts/routes.ts") },
      ],
      [],
    );

    expect(wiring).toEqual([
      { type: "file", role: "config", file: "src/config/http.ts", module: "src/config", order: 1 },
      { type: "file", role: "main", file: "src/app/posts/main.ts", module: "src/app/posts", order: 2 },
      { type: "file", role: "route", file: "src/app/posts/routes.ts", module: "src/app/posts", order: 3 },
    ]);
  });

  it("lists capabilities after the files with project-relative paths and sorted consumers", () => {
    const [entry] = collectWiring(cwd, [], [slot()]);

    expect(entry).toEqual({
      type: "capability",
      name: "posts.notifier",
      description: "Tells followers",
      required: true,
      provided: true,
      definedIn: "src/app/posts/capabilities.ts",
      providedBy: "src/app/posts/main.ts",
      consumers: ["src/app/posts/services/a.service.ts", "src/app/posts/services/b.service.ts"],
    });
  });

  it("reports an unprovided capability with no provider file", () => {
    const [entry] = collectWiring(cwd, [], [slot({ provided: false, providedBy: null, consumers: [] })]);

    expect(entry).toMatchObject({ provided: false, providedBy: null, consumers: [] });
  });

  it("puts every file before every capability", () => {
    const wiring = collectWiring(cwd, [{ role: "main", file: "src/app/a/main.ts" }], [slot()]);

    expect(wiring.map((entry) => entry.type)).toEqual(["file", "capability"]);
  });
});
