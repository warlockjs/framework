import { describe, expect, it } from "vitest";
import { buildBootProfile, formatBootProfile } from "./boot-profile";
import type { ProfiledFile } from "./boot-profile";

const files: ProfiledFile[] = [
  {
    file: "/app/a.test.ts",
    pid: "10",
    steps: {
      environment: 1,
      config: 10,
      bootstrap: 20,
      orchestrator: 5,
      appConfig: 4,
      locales: 3,
      connectors: 100,
      "connector.database": 70,
      "connector.web": 25,
      fakes: 2,
      appModules: 40,
      teardown: 6,
      body: 50,
    },
  },
  { file: "/app/b.test.ts", pid: "10", steps: { reset: 8, body: 400 } },
  { file: "/app/c.test.ts", pid: "11", steps: { reset: 9, body: 5 } },
];

describe("buildBootProfile", () => {
  it("groups steps into phases without counting per-connector time twice", () => {
    const { phases } = buildBootProfile(files);

    expect(phases.config).toBe(40);
    expect(phases.translations).toBe(3);
    expect(phases.connectors).toBe(100);
    expect(phases.fakes).toBe(2);
    expect(phases.routes).toBe(40);
    expect(phases.reset).toBe(17);
    expect(phases.teardown).toBe(6);
  });

  it("itemises connectors by name and totals the test time", () => {
    const profile = buildBootProfile(files);

    expect(profile.connectors).toEqual({ database: 70, web: 25 });
    expect(profile.bodyMs).toBe(455);
  });

  it("ranks the slowest files by setup plus test time", () => {
    const { slowestFiles } = buildBootProfile(files, { slowest: 2 });

    expect(slowestFiles.map((entry) => entry.file)).toEqual(["/app/b.test.ts", "/app/a.test.ts"]);
    expect(slowestFiles[1]).toMatchObject({ setupMs: 191, bodyMs: 50 });
  });
});

describe("formatBootProfile", () => {
  it("prints phases, connectors, the server boot and the slowest files", () => {
    const lines = formatBootProfile(buildBootProfile(files), { steps: { "connector.web": 800 } });

    expect(lines[0]).toContain("boot phases config=40.00ms");
    expect(lines[0]).toContain("connectors=100.00ms");
    expect(lines).toContain("[warlock:test] connectors database=70.00ms web=25.00ms");
    expect(lines.some((line) => line.includes("http server boot connector.web=800.00ms"))).toBe(
      true,
    );
    expect(lines.at(-4)).toBe("[warlock:test] slowest files");
    expect(lines.at(-3)).toContain("/app/b.test.ts");
  });
});
