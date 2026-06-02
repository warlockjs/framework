import { v } from "@warlock.js/seal";
import { describe, expect, it, vi } from "vitest";
import { validateAll } from "../../../src/validation/validateAll";

/**
 * validateAll() only touches a small, well-defined slice of Request/Response,
 * so thin structural stubs stand in for the full HTTP objects.
 */
const makeRequest = (data: Record<string, unknown>) => {
  return {
    body: data,
    query: {},
    params: {},
    headers: {},
    allExceptParams: () => data,
    setValidatedData: vi.fn(),
  };
};

const makeResponse = () => {
  return {
    statusCode: 0,
    failedSchema: vi.fn((result: unknown) => ({ failed: result })),
    setStatusCode: vi.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
    }),
  };
};

describe("validateAll - schema validation", () => {
  it("returns nothing and stores validated data when the schema passes", async () => {
    const request = makeRequest({ name: "Hasan", age: 30 });
    const response = makeResponse();

    const validation = {
      schema: v.object({ name: v.string().required(), age: v.int().min(18) }),
      validating: ["body"] as const,
    };

    const result = await validateAll(validation as never, request as never, response as never);

    expect(result).toBeUndefined();
    expect(request.setValidatedData).toHaveBeenCalledWith({ name: "Hasan", age: 30 });
    expect(response.failedSchema).not.toHaveBeenCalled();
  });

  it("calls response.failedSchema when the schema fails", async () => {
    const request = makeRequest({ name: "Hasan", age: 10 });
    const response = makeResponse();

    const validation = {
      schema: v.object({ name: v.string().required(), age: v.int().min(18) }),
      validating: ["body"] as const,
    };

    await validateAll(validation as never, request as never, response as never);

    expect(response.failedSchema).toHaveBeenCalledTimes(1);
    expect(request.setValidatedData).not.toHaveBeenCalled();

    const failedResult = response.failedSchema.mock.calls[0][0] as { isValid: boolean };
    expect(failedResult.isValid).toBe(false);
  });

  it("does nothing when no validation is provided", async () => {
    const request = makeRequest({});
    const response = makeResponse();

    await expect(
      validateAll(undefined as never, request as never, response as never),
    ).resolves.toBeUndefined();

    expect(request.setValidatedData).not.toHaveBeenCalled();
  });
});

describe("validateAll - custom validate function", () => {
  it("returns the result and leaves the status when validate fails with a status set", async () => {
    const request = makeRequest({});
    const response = makeResponse();

    response.statusCode = 422;

    const failure = { message: "custom failure" };

    const validation = {
      validate: vi.fn(async () => failure),
    };

    const result = await validateAll(validation as never, request as never, response as never);

    expect(result).toBe(failure);
    expect(response.setStatusCode).not.toHaveBeenCalled();
  });

  it("passes through when the custom validate returns nothing", async () => {
    const request = makeRequest({});
    const response = makeResponse();

    const validation = {
      validate: vi.fn(async () => undefined),
    };

    const result = await validateAll(validation as never, request as never, response as never);

    expect(result).toBeUndefined();
    expect(validation.validate).toHaveBeenCalledWith(request, response);
  });
});
