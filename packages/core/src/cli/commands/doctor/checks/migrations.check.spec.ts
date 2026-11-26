import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DoctorBootContext } from "../check.types";

const state = vi.hoisted(() => ({ appDirectory: "" }));

vi.mock("../../../../utils/paths", () => ({ appPath: () => state.appDirectory }));

import { migrationsCheck } from "./migrations.check";

const bootContext = {} as DoctorBootContext;
const roots: string[] = [];

function appWith(files: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "wl-doctor-migrations-"));
  roots.push(root);

  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "export {};\n");
  }

  state.appDirectory = root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("doctor migrations check", () => {
  it("is silent when every migration file is discovered", async () => {
    appWith(["users/migrations/a.migration.ts", "ai/x/models/y/migrations/b.migration.ts"]);

    expect(await migrationsCheck.run(bootContext)).toBeUndefined();
  });

  it("warns, naming the file, for a migration outside the discovered folders", async () => {
    appWith(["users/migrations/a.migration.ts", "users/legacy/old.migration.ts"]);

    const result = await migrationsCheck.run(bootContext);

    expect(result?.status).toBe("warn");
    expect(result?.code).toBe("WL9106");
    expect(result?.detail).toContain("users/legacy/old.migration.ts");
  });
});
