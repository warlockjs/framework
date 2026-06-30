import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the doctor RELEASE-HYGIENE check: the version↔changelog
 * invariant. `node:fs` and the project-root path helper are mocked so the
 * version/heading comparison is exercised without touching disk.
 */

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

type FsMock = {
  packageJson: string;
  changelog?: string;
};

/**
 * Stub `node:fs` and the `rootPath` helper for one scenario. `changelog`
 * undefined models a missing CHANGELOG.md (so `existsSync` returns false).
 */
function mockProject({ packageJson, changelog }: FsMock): void {
  vi.doMock("../../../../src/utils/paths", () => ({
    rootPath: (file: string) => file,
  }));

  vi.doMock("node:fs", () => ({
    existsSync: (file: string) => file === "CHANGELOG.md" && changelog !== undefined,
    readFileSync: (file: string) => {
      if (file === "package.json") {
        return packageJson;
      }

      if (file === "CHANGELOG.md" && changelog !== undefined) {
        return changelog;
      }

      throw new Error(`unexpected read of ${file}`);
    },
  }));
}

const importCheck = async () => {
  const module = await import(
    "../../../../src/cli/commands/doctor/checks/release-hygiene.check"
  );

  return module.releaseHygieneCheck;
};

describe("releaseHygieneCheck", () => {
  it("passes when package.json version matches the top changelog heading", async () => {
    mockProject({
      packageJson: JSON.stringify({ version: "4.5.0" }),
      changelog: "# Changelog\n\n## 4.5.0 - 2026-06-30\n\n- stuff\n",
    });

    const result = await (await importCheck()).run();

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("4.5.0");
  });

  it("fails when the changelog heading disagrees with package.json", async () => {
    mockProject({
      packageJson: JSON.stringify({ version: "4.5.0" }),
      changelog: "## 4.4.0\n\n- old\n",
    });

    const result = await (await importCheck()).run();

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("4.5.0");
    expect(result.detail).toContain("4.4.0");
  });

  it("warns when there is no CHANGELOG.md", async () => {
    mockProject({ packageJson: JSON.stringify({ version: "1.0.0" }) });

    const result = await (await importCheck()).run();

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("no CHANGELOG.md");
  });

  it("warns when the changelog has no parseable version heading", async () => {
    mockProject({
      packageJson: JSON.stringify({ version: "1.0.0" }),
      changelog: "# Changelog\n\nsome prose without a version heading\n",
    });

    const result = await (await importCheck()).run();

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("no parseable");
  });

  it("fails when package.json has no string version", async () => {
    mockProject({ packageJson: JSON.stringify({ name: "x" }) });

    const result = await (await importCheck()).run();

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("no string version");
  });
});
