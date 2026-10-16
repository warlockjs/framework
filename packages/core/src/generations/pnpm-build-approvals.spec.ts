import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isInsideParentPnpmWorkspace,
  mergeOnlyBuiltDependencies,
  mergePackageJsonBuildApprovals,
  mergePnpmSharpApproval,
  pnpmBuildApprovalLayout,
} from "./pnpm-build-approvals";

describe("pnpm image feature build approval", () => {
  it("adds sharp beside existing approvals and replaces an undecided placeholder", () => {
    expect(mergePnpmSharpApproval("allowBuilds:\n  esbuild: true\n")).toBe(
      "allowBuilds:\n  sharp: true\n  esbuild: true\n",
    );
    expect(
      mergePnpmSharpApproval("allowBuilds:\n  sharp: set this to true or false # generated\n"),
    ).toBe("allowBuilds:\n  sharp: true # generated\n");
  });

  it("preserves explicit denials, flow mappings, and unrelated configuration", () => {
    const denied =
      "packages:\n  - apps/*\nallowBuilds:\n  'sharp': false # user choice\n  esbuild: true\n";
    expect(mergePnpmSharpApproval(denied)).toBe(denied);
    const flow = "allowBuilds: { sharp: false, esbuild: true }\n";
    expect(mergePnpmSharpApproval(flow)).toBe(flow);
    const anchored = "allowBuilds: *sharedPolicy\n";
    expect(mergePnpmSharpApproval(anchored)).toBe(anchored);
    const unknown = "allowBuilds:\n  sharp: *nativePolicy\n";
    expect(mergePnpmSharpApproval(unknown)).toBe(unknown);
  });

  it("creates a local policy when none exists", () => {
    expect(mergePnpmSharpApproval("")).toBe("\nallowBuilds:\n  sharp: true\n");
  });
});

describe("pnpmBuildApprovalLayout", () => {
  it.each([
    ["7.33.7", "packageJson"],
    ["9.15.9", "packageJson"],
    ["10.0.0", "packageJson"],
    ["10.4.0", "packageJson"],
    ["10.5.0", "onlyBuiltDependencies"],
    ["10.25.3", "onlyBuiltDependencies"],
    ["10.26.0", "allowBuilds"],
    ["11.28.6", "allowBuilds"],
    ["12.11.2", "allowBuilds"],
  ])("pnpm %s reads approvals from %s", (version, layout) => {
    expect(pnpmBuildApprovalLayout(version)).toBe(layout);
  });

  it("uses the current layout when the version is unknown", () => {
    expect(pnpmBuildApprovalLayout(undefined)).toBe("allowBuilds");
    expect(pnpmBuildApprovalLayout("not a version")).toBe("allowBuilds");
  });
});

describe("mergeOnlyBuiltDependencies", () => {
  it("creates the list in a settings-only workspace file", () => {
    expect(mergeOnlyBuiltDependencies("allowBuilds:\n  esbuild: true\n", ["sharp"])).toBe(
      "allowBuilds:\n  esbuild: true\n\n# pnpm 10.5-10.25 read install-script approvals from this list.\nonlyBuiltDependencies:\n  - sharp\n",
    );
  });

  it("adds only missing entries and leaves flow lists alone", () => {
    const listed = "onlyBuiltDependencies:\n  - esbuild\n";

    expect(mergeOnlyBuiltDependencies(listed, ["esbuild", "sharp"])).toBe(
      "onlyBuiltDependencies:\n  - sharp\n  - esbuild\n",
    );
    expect(mergeOnlyBuiltDependencies(listed, ["esbuild"])).toBe(listed);

    const flow = "onlyBuiltDependencies: [esbuild]\n";

    expect(mergeOnlyBuiltDependencies(flow, ["sharp"])).toBe(flow);
  });
});

describe("mergePackageJsonBuildApprovals", () => {
  it("adds to pnpm.onlyBuiltDependencies, keeping other fields and order", () => {
    expect(
      mergePackageJsonBuildApprovals(
        { name: "app", pnpm: { overrides: { a: "1" }, onlyBuiltDependencies: ["esbuild"] } },
        ["esbuild", "sharp"],
      ),
    ).toEqual({
      name: "app",
      pnpm: { overrides: { a: "1" }, onlyBuiltDependencies: ["esbuild", "sharp"] },
    });
    expect(mergePackageJsonBuildApprovals({ name: "app" }, ["sharp"])).toEqual({
      name: "app",
      pnpm: { onlyBuiltDependencies: ["sharp"] },
    });
  });
});

describe("isInsideParentPnpmWorkspace", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("finds a workspace file above the app, not the app's own", () => {
    root = mkdtempSync(path.join(tmpdir(), "warlock-pnpm-ws-"));
    const app = path.join(root, "apps", "site");

    mkdirSync(app, { recursive: true });
    writeFileSync(path.join(app, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: true\n");

    expect(isInsideParentPnpmWorkspace(app)).toBe(false);

    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");

    expect(isInsideParentPnpmWorkspace(app)).toBe(true);
  });
});
