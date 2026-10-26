import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPageErrorHooksForTests, onPageError } from "./page-error-hooks";
import {
  flushPendingServerErrorReports,
  reportServerError,
  resetServerErrorReportingStateForTests,
} from "./report-server-error";
import type { ServerErrorContext } from "./error-reporting-config";

const context: ServerErrorContext = {
  kind: "render",
  phase: "render",
  pathname: "/posts/42",
  method: "GET",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetServerErrorReportingStateForTests();
  clearPageErrorHooksForTests();
  config.set("web", {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearPageErrorHooksForTests();
  resetServerErrorReportingStateForTests();
});

describe("onPageError()", () => {
  it("receives the error and context of a server failure", async () => {
    const hook = vi.fn();
    onPageError(hook);
    const error = new Error("boom");

    reportServerError("page failed", error, context);
    await flushPendingServerErrorReports();

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(error, expect.objectContaining({ pathname: "/posts/42" }));
  });

  it("runs next to web.errors.report, each once", async () => {
    const configured = vi.fn();
    const registered = vi.fn();
    config.set("web", { errors: { report: configured } });
    onPageError(registered);

    reportServerError("page failed", new Error("boom"), context);
    await flushPendingServerErrorReports();

    expect(configured).toHaveBeenCalledTimes(1);
    expect(registered).toHaveBeenCalledTimes(1);
  });

  it("stops calling a hook once it is unregistered", async () => {
    const hook = vi.fn();
    const unregister = onPageError(hook);

    unregister();
    reportServerError("page failed", new Error("boom"), context);
    await flushPendingServerErrorReports();

    expect(hook).not.toHaveBeenCalled();
  });

  it("isolates a throwing hook from the others", async () => {
    const survivor = vi.fn();
    onPageError(() => {
      throw new Error("reporter down");
    });
    onPageError(survivor);

    reportServerError("page failed", new Error("boom"), context);
    await flushPendingServerErrorReports();

    expect(survivor).toHaveBeenCalledTimes(1);
  });
});
