import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestSetupReporter } from "./test-setup-reporter";

afterEach(() => vi.restoreAllMocks());
describe("setup profiling run summary", () => {
  it("aggregates file timings and bootstrap counts across workers without counting summaries twice", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const reporter = new TestSetupReporter();
    reporter.onTestRunStart();
    reporter.onUserConsoleLog({
      content:
        '[warlock:test] file="one.test.ts" pid=100 bootstrap=12.50ms config=2.00ms teardown=0.10ms\n',
    });
    reporter.onUserConsoleLog({
      content: '[warlock:test] file="two.test.ts" pid=100 reset=1.00ms teardown=0.20ms',
    });
    reporter.onUserConsoleLog({
      content:
        '[warlock:test] file="three.test.ts" pid=200 bootstrap=10.00ms config=3.00ms teardown=0.10ms',
    });
    reporter.onUserConsoleLog({
      content: "[warlock:test] summary pid=100 files=2 bootstraps=1 config=2.00ms shutdown=4.00ms",
    });
    reporter.onUserConsoleLog({
      content: "[warlock:test] summary pid=200 files=1 bootstraps=1 config=3.00ms shutdown=6.00ms",
    });
    reporter.onTestRunEnd();
    expect(output).toHaveBeenCalledTimes(1);
    expect(output.mock.calls[0]?.[0]).toContain("files=3 workers=2 bootstraps=2");
    expect(output.mock.calls[0]?.[0]).toContain("config=5.00ms");
    expect(output.mock.calls[0]?.[0]).toContain("shutdown=10.00ms");
    reporter.onTestRunStart();
    reporter.onTestRunEnd();
    expect(output).toHaveBeenCalledTimes(1);
  });
  it("stays silent when setup profiling is disabled", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const reporter = new TestSetupReporter();
    reporter.onUserConsoleLog({ content: "ordinary test output" });
    reporter.onTestRunEnd();
    expect(output).not.toHaveBeenCalled();
  });
  it("recommends worker lifetime when setup dominates a file-lifetime run", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const reporter = new TestSetupReporter();
    reporter.onTestRunStart();
    for (let file = 0; file < 4; file += 1) {
      reporter.onUserConsoleLog({
        content: `[warlock:test] file="f${file}.test.ts" pid=100 bootstrap=900.00ms teardown=50.00ms body=50.00ms`,
      });
    }
    reporter.onTestRunEnd();
    expect(output).toHaveBeenCalledTimes(2);
    expect(String(output.mock.calls[1]?.[0])).toContain('tests.lifetime: "worker"');
  });

  it("does not recommend it when files share a runtime or tests dominate", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const reporter = new TestSetupReporter();
    reporter.onTestRunStart();
    reporter.onUserConsoleLog({
      content: '[warlock:test] file="a.test.ts" pid=100 bootstrap=900.00ms body=10.00ms',
    });
    for (const name of ["b", "c", "d"]) {
      reporter.onUserConsoleLog({
        content: `[warlock:test] file="${name}.test.ts" pid=100 reset=1.00ms body=10.00ms`,
      });
    }
    reporter.onTestRunEnd();
    expect(output).toHaveBeenCalledTimes(1);
  });

  it("prints the boot phases and slowest files in the same block as the run summary", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const reporter = new TestSetupReporter({ slowest: 1 });
    reporter.onTestRunStart();
    reporter.onUserConsoleLog({
      content:
        '[warlock:test] file="/app/slow.test.ts" pid=100 bootstrap=10.00ms connectors=90.00ms connector.database=60.00ms connector.web=25.00ms body=500.00ms',
    });
    reporter.onUserConsoleLog({
      content: '[warlock:test] file="/app/fast.test.ts" pid=100 reset=1.00ms body=2.00ms',
    });
    reporter.onTestRunEnd();
    const text = String(output.mock.calls[0]?.[0]);
    expect(output).toHaveBeenCalledTimes(1);
    expect(text).toContain("boot phases config=10.00ms");
    expect(text).toContain("connectors database=60.00ms web=25.00ms");
    expect(text).toContain("/app/slow.test.ts");
    expect(text).not.toContain("/app/fast.test.ts");
  });

  it("writes the profile as JSON when a path is given", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-profile-"));
    const target = path.join(directory, "profile.json");
    try {
      const reporter = new TestSetupReporter({ json: target });
      reporter.onTestRunStart();
      reporter.onUserConsoleLog({
        content:
          '[warlock:test] file="/app/a.test.ts" pid=100 bootstrap=10.00ms connector.web=25.00ms body=5.00ms',
      });
      reporter.onTestRunEnd();
      const document = JSON.parse(readFileSync(target, "utf8"));
      expect(document.files).toBe(1);
      expect(document.connectors).toEqual({ web: 25 });
      expect(document.phases.config).toBe(10);
      expect(document.slowestFiles[0].file).toBe("/app/a.test.ts");
      expect(document.perFile).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
