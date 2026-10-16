import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_PNPM_BUILD_APPROVALS,
  mergeOnlyBuiltDependencies,
  mergePackageJsonBuildApprovals,
  mergePnpmBuildApprovals,
  pnpmBuildApprovalLayout,
  requiredPnpmBuildApprovals,
} from "../../src/helpers/pnpm-build-approvals";

describe("pnpm feature build approvals", () => {
  it("approves sharp for a fresh selected image feature alongside the template's esbuild policy", () => {
    expect(requiredPnpmBuildApprovals(["image"])).toEqual(["sharp"]);
    expect(
      mergePnpmBuildApprovals("allowBuilds:\n  esbuild: true\n", ["sharp"]),
    ).toBe("allowBuilds:\n  sharp: true\n  esbuild: true\n");
  });

  it("preserves an explicit sharp denial and unrelated workspace YAML", () => {
    const yaml =
      "packages:\n  - apps/*\nallowBuilds:\n  'sharp': false # user declined native builds\n  esbuild: true\nminimumReleaseAge: 60\n";
    expect(mergePnpmBuildApprovals(yaml, ["sharp"])).toBe(yaml);
  });

  it("replaces pnpm's undecided sharp placeholder in place and stays idempotent", () => {
    const yaml =
      "allowBuilds:\n  sharp: set this to true or false # generated placeholder\n  esbuild: true\n";
    const approved = mergePnpmBuildApprovals(yaml, ["sharp"]);
    expect(approved).toBe(
      "allowBuilds:\n  sharp: true # generated placeholder\n  esbuild: true\n",
    );
    expect(mergePnpmBuildApprovals(approved, ["sharp"])).toBe(approved);
  });

  it("does not duplicate a decided flow mapping", () => {
    const yaml = "allowBuilds: { sharp: false, esbuild: true }\n";
    expect(mergePnpmBuildApprovals(yaml, ["sharp"])).toBe(yaml);
    const anchored = "allowBuilds: *sharedPolicy\n";
    expect(mergePnpmBuildApprovals(anchored, ["sharp"])).toBe(anchored);
    const unknown = "allowBuilds:\n  sharp: *nativePolicy\n";
    expect(mergePnpmBuildApprovals(unknown, ["sharp"])).toBe(unknown);
  });
});

describe("pnpm build-approval layout by version (measured with real installs)", () => {
  it.each([
    ["7.33.7", "packageJson"],
    ["8.15.9", "packageJson"],
    ["9.15.9", "packageJson"],
    ["10.0.0", "packageJson"],
    ["10.4.0", "packageJson"],
    ["10.5.0", "onlyBuiltDependencies"],
    ["10.25.0", "onlyBuiltDependencies"],
    ["10.26.0", "allowBuilds"],
    ["10.34.7", "allowBuilds"],
    ["11.0.0", "allowBuilds"],
    ["11.28.6", "allowBuilds"],
    ["12.11.2", "allowBuilds"],
    ["12.11.2\n", "allowBuilds"],
    [undefined, "allowBuilds"],
    ["not a version", "allowBuilds"],
  ] as const)("pnpm %s -> %s", (version, layout) => {
    expect(pnpmBuildApprovalLayout(version)).toBe(layout);
  });

  it("the template's allowBuilds map is exactly the base approvals the older layouts write", () => {
    const yaml = readFileSync(
      path.resolve(__dirname, "../../templates/warlock/pnpm-workspace.yaml"),
      "utf8",
    );
    const block = /^allowBuilds:\n((?:[ \t]+.*\n?)*)/m.exec(yaml)?.[1] ?? "";
    const approved = [...block.matchAll(/^\s+['"]?([^'":\s]+)['"]?\s*:\s*true/gm)].map((m) => m[1]);

    expect(approved).toEqual([...BASE_PNPM_BUILD_APPROVALS]);
  });
});

describe("mergeOnlyBuiltDependencies", () => {
  it("creates the list after the existing settings", () => {
    expect(mergeOnlyBuiltDependencies("allowBuilds:\n  esbuild: true\n", ["esbuild"])).toBe(
      "allowBuilds:\n  esbuild: true\n\n# pnpm 10.5-10.25 read install-script approvals from this list.\nonlyBuiltDependencies:\n  - esbuild\n",
    );
  });

  it("appends only missing names, keeps the list's indentation, and is idempotent", () => {
    const yaml = "onlyBuiltDependencies:\n    - esbuild\nminimumReleaseAge: 60\n";
    const merged = mergeOnlyBuiltDependencies(yaml, ["esbuild", "sharp"]);

    expect(merged).toBe("onlyBuiltDependencies:\n    - sharp\n    - esbuild\nminimumReleaseAge: 60\n");
    expect(mergeOnlyBuiltDependencies(merged, ["esbuild", "sharp"])).toBe(merged);
  });

  it("recognises quoted entries and leaves a flow list alone", () => {
    expect(mergeOnlyBuiltDependencies("onlyBuiltDependencies:\n  - 'sharp'\n", ["sharp"])).toBe(
      "onlyBuiltDependencies:\n  - 'sharp'\n",
    );
    const flow = "onlyBuiltDependencies: [esbuild]\n";
    expect(mergeOnlyBuiltDependencies(flow, ["sharp"])).toBe(flow);
  });
});

describe("mergePackageJsonBuildApprovals", () => {
  it("adds pnpm.onlyBuiltDependencies, keeping other pnpm settings and existing entries", () => {
    expect(
      mergePackageJsonBuildApprovals(
        { name: "app", pnpm: { overrides: { vite: "7" }, onlyBuiltDependencies: ["esbuild"] } },
        ["esbuild", "sharp"],
      ),
    ).toEqual({
      name: "app",
      pnpm: { overrides: { vite: "7" }, onlyBuiltDependencies: ["esbuild", "sharp"] },
    });
    expect(mergePackageJsonBuildApprovals({ name: "app" }, ["esbuild"])).toEqual({
      name: "app",
      pnpm: { onlyBuiltDependencies: ["esbuild"] },
    });
  });
});
