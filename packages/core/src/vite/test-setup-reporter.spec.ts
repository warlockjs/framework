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
});
