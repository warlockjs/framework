import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverMigrationFiles, findUndiscoveredMigrations } from "./migration-discovery";

const roots: string[] = [];

function tree(files: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "wl-migrations-"));
  roots.push(root);

  for (const file of files) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "export {};\n");
  }

  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const relative = (root: string, files: string[]) =>
  files.map((file) => path.relative(root, file).replaceAll("\\", "/"));

describe("migration discovery", () => {
  it("finds migrations in nested models folders and in module migrations folders", async () => {
    const root = tree([
      "ai/models/chat/migrations/01-01-2026_10-00-00-chat.migration.ts",
      "ai/capabilities/models/tool/migrations/01-02-2026_10-00-00-tool.migration.ts",
      "users/migrations/01-03-2026_10-00-00-users.migration.ts",
      "users/migrations/skipped.spec.ts",
    ]);

    expect(relative(root, await discoverMigrationFiles(root))).toEqual([
      "ai/capabilities/models/tool/migrations/01-02-2026_10-00-00-tool.migration.ts",
      "ai/models/chat/migrations/01-01-2026_10-00-00-chat.migration.ts",
      "users/migrations/01-03-2026_10-00-00-users.migration.ts",
    ]);
  });

  it("lists a file once even when two patterns match it", async () => {
    const root = tree(["users/models/user/migrations/a.migration.ts"]);

    expect(await discoverMigrationFiles(root)).toHaveLength(1);
  });

  it("reports migration files discovery does not pick up", async () => {
    const root = tree([
      "users/migrations/ok.migration.ts",
      "users/legacy/old.migration.ts",
      "users/models/user/other/stray.migration.ts",
    ]);

    expect(await findUndiscoveredMigrations(root)).toEqual([
      "users/legacy/old.migration.ts",
      "users/models/user/other/stray.migration.ts",
    ]);
  });

  it("reports nothing when every migration is discovered", async () => {
    const root = tree(["users/migrations/ok.migration.ts"]);

    expect(await findUndiscoveredMigrations(root)).toEqual([]);
  });
});
