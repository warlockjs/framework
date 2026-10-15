import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * cascade supports two optional database drivers (PostgreSQL via `pg`,
 * MongoDB via `mongodb`). A project uses at most one of them (or neither),
 * so both must be declared optional in `peerDependenciesMeta` — otherwise
 * `npm ls` reports `missing: mongodb` / `missing: pg` for any app that only
 * installs one driver, or none at all.
 */
describe("package.json optional driver peers", () => {
  const packageJsonPath = path.resolve(__dirname, "../../../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  const databaseDriverPeers = ["pg", "mongodb"];

  it.each(databaseDriverPeers)(
    "marks the %s peer dependency as optional in peerDependenciesMeta",
    (driverName) => {
      expect(packageJson.peerDependencies).toHaveProperty(driverName);
      expect(packageJson.peerDependenciesMeta?.[driverName]).toEqual({
        optional: true,
      });
    },
  );
});
