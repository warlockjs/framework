import { afterEach, describe, expect, it } from "vitest";
import { v } from "@warlock.js/seal";
import type { RequestHandler } from "../router/types";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

describe("route validation.params", () => {
  it("coerces a validated integer param for input() and validated()", async () => {
    const handler: RequestHandler = ({ request, response }) =>
      response.success({ id: request.input("id"), validated: request.validated() });

    handler.validation = { params: v.object({ id: v.int().required() }) };

    harness = await bootHarness((router) => {
      router.get("/posts/:id", handler);
    });

    const result = await harness.inject({ method: "GET", url: "/posts/42" });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result)).toEqual({ id: 42, validated: { id: 42 } });
  });

  it("returns the standard 422 field-error response for an invalid param", async () => {
    const handler: RequestHandler = ({ response }) => response.success({ reached: true });

    handler.validation = { params: v.object({ id: v.int().required() }) };

    harness = await bootHarness((router) => {
      router.get("/posts/:id", handler);
    });

    const result = await harness.inject({ method: "GET", url: "/posts/not-a-number" });

    expect(result.statusCode).toBe(422);
    expect(harness.json(result).errors[0]).toMatchObject({ input: "id" });
  });

  it("leaves params as raw strings when validation.params is absent", async () => {
    harness = await bootHarness((router) => {
      router.get("/posts/:id", ({ request, response }) =>
        response.success({ id: request.input("id") }),
      );
    });

    const result = await harness.inject({ method: "GET", url: "/posts/42" });

    expect(harness.json(result)).toEqual({ id: "42" });
  });

  it("combines coerced params with validated body data", async () => {
    const handler: RequestHandler = ({ request, response }) =>
      response.success({ id: request.input("id"), data: request.validated() });

    handler.validation = {
      schema: v.object({ title: v.string().required() }),
      validating: ["body"],
      params: v.object({ id: v.int().required() }),
    };

    harness = await bootHarness((router) => {
      router.post("/posts/:id", handler);
    });

    const result = await harness.inject({
      method: "POST",
      url: "/posts/42",
      payload: { title: "A post" },
    });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result)).toEqual({ id: 42, data: { title: "A post", id: 42 } });
  });
});
