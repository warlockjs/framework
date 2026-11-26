import { afterEach, describe, expect, it, vi } from "vitest";
import { defineJob, InvalidJobDefinitionError, setDispatchInterceptor } from "../src";
import { assertJobId } from "../src/job-options";

describe("jobId validation", () => {
  afterEach(() => setDispatchInterceptor(undefined));

  it("accepts ids with dashes and mixed characters", () => {
    expect(() => assertJobId("invoice-43")).not.toThrow();
    expect(() => assertJobId("43a")).not.toThrow();
    expect(() => assertJobId(undefined)).not.toThrow();
  });

  it("rejects an id with a colon and suggests another separator", () => {
    expect(() => assertJobId("invoice:43")).toThrow(InvalidJobDefinitionError);
    expect(() => assertJobId("invoice:43")).toThrow(/invoice-43/);
  });

  it("rejects an id made only of digits", () => {
    expect(() => assertJobId("43")).toThrow(/digits/);
  });

  it("rejects an empty id", () => {
    expect(() => assertJobId("")).toThrow(/non-empty/);
  });

  it("refuses the same ids on a fake queue, before the interceptor sees them", async () => {
    const dispatch = vi.fn(() => ({ id: "fake", name: "ids.check", queue: "default" }));

    setDispatchInterceptor({ dispatch });

    const job = defineJob({
      name: "ids.check",
      async handle(_payload: { n: number }) {},
    });

    await expect(job.dispatch({ n: 1 }, { jobId: "invoice:43" })).rejects.toThrow(
      InvalidJobDefinitionError,
    );
    await expect(job.dispatch({ n: 1 }, { jobId: "43" })).rejects.toThrow(
      InvalidJobDefinitionError,
    );
    expect(dispatch).not.toHaveBeenCalled();

    await job.dispatch({ n: 1 }, { jobId: "invoice-43" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("refuses a bad id before any driver is reached", async () => {
    const job = defineJob({
      name: "ids.driverless",
      async handle(_payload: { n: number }) {},
    });

    await expect(job.dispatch({ n: 1 }, { jobId: "a:b" })).rejects.toThrow(
      InvalidJobDefinitionError,
    );
  });
});
