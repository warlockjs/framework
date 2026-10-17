import config from "@mongez/config";
import { v, type ValidationResult } from "@warlock.js/seal";
import { afterEach, describe, expect, it } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import type { RequestHandler, Route, ValidationFailureContext } from "../router/types";

let harness: HttpHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  config.set("validation.response", undefined);
});

const importSchema = v.object({ name: v.string().required() });

function importController(): RequestHandler {
  return ({ response }) => response.success({ imported: true });
}

async function postImport(register: (handler: RequestHandler) => void) {
  harness = await bootHarness((router) => {
    const handler = importController();
    register(handler);
    router.post("/imports", handler, { name: "imports.create" });
  });

  return harness.inject({ method: "POST", url: "/imports", payload: {} });
}

describe("route validation failure response", () => {
  it("keeps the framework body and 422 when no hook is set", async () => {
    const result = await postImport((handler) => {
      handler.validation = { schema: importSchema };
    });

    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body)).toEqual({
      errors: [{ input: "name", error: expect.any(String) }],
    });
  });

  it("answers with the route hook's status and body", async () => {
    let seen: { result: ValidationResult; context: ValidationFailureContext } | undefined;

    const result = await postImport((handler) => {
      handler.validation = {
        schema: importSchema,
        onFailure: (failure, context) => {
          seen = { result: failure, context };

          return { status: 400, body: { error: "IMPORT_REQUEST_INVALID" } };
        },
      };
    });

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ error: "IMPORT_REQUEST_INVALID" });
    expect(seen?.result.isValid).toBe(false);
    expect(seen?.result.errors[0]?.input).toBe("name");
    expect(seen?.context.route.name).toBe("imports.create");
    expect(seen?.context.request.path).toBe("/imports");
  });

  it("uses the configured failure status when the route hook omits one", async () => {
    config.set("validation.response", { status: 409 });

    const result = await postImport((handler) => {
      handler.validation = {
        schema: importSchema,
        onFailure: async () => ({ body: { error: "IMPORT_REQUEST_INVALID" } }),
      };
    });

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body)).toEqual({ error: "IMPORT_REQUEST_INVALID" });
  });

  it("applies the global body hook with the failing route", async () => {
    const routes: Route[] = [];

    config.set("validation.response", {
      status: 400,
      body: (failure: ValidationResult, route: Route) => {
        routes.push(route);

        return { error: `${route.name}.invalid`, fields: failure.errors.length };
      },
    });

    const result = await postImport((handler) => {
      handler.validation = { schema: importSchema };
    });

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ error: "imports.create.invalid", fields: 1 });
    expect(routes.map((route) => route.path)).toEqual(["/imports"]);
  });

  it("keeps the framework body when the global hook returns undefined", async () => {
    config.set("validation.response", { body: () => undefined });

    const result = await postImport((handler) => {
      handler.validation = { schema: importSchema };
    });

    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).errors[0].input).toBe("name");
  });

  it("lets the route hook win over the global hook", async () => {
    config.set("validation.response", { body: () => ({ error: "GLOBAL" }) });

    const result = await postImport((handler) => {
      handler.validation = {
        schema: importSchema,
        onFailure: () => ({ status: 400, body: { error: "ROUTE" } }),
      };
    });

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ error: "ROUTE" });
  });

  it("falls back to the global hook when the route hook returns undefined", async () => {
    config.set("validation.response", { body: () => ({ error: "GLOBAL" }) });

    const result = await postImport((handler) => {
      handler.validation = { schema: importSchema, onFailure: () => undefined };
    });

    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body)).toEqual({ error: "GLOBAL" });
  });

  it("runs the hook for a failing params schema too", async () => {
    harness = await bootHarness((router) => {
      const handler = importController();
      handler.validation = {
        params: v.object({ id: v.int().required() }),
        onFailure: () => ({ status: 404, body: { error: "IMPORT_NOT_FOUND" } }),
      };
      router.get("/imports/:id", handler);
    });

    const result = await harness.inject({ method: "GET", url: "/imports/not-a-number" });

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: "IMPORT_NOT_FOUND" });
  });

  it("accepts validation as a route option, merged over the handler's", async () => {
    harness = await bootHarness((router) => {
      const handler = importController();
      handler.validation = { schema: importSchema };
      router.post("/imports", handler);
      router.post("/workspace-imports", handler, {
        validation: {
          onFailure: () => ({ status: 400, body: { error: "WORKSPACE_IMPORT_INVALID" } }),
        },
      });
    });

    const plain = await harness.inject({ method: "POST", url: "/imports", payload: {} });
    const custom = await harness.inject({
      method: "POST",
      url: "/workspace-imports",
      payload: {},
    });
    const valid = await harness.inject({
      method: "POST",
      url: "/workspace-imports",
      payload: { name: "Acme" },
    });

    expect(plain.statusCode).toBe(422);
    expect(custom.statusCode).toBe(400);
    expect(JSON.parse(custom.body)).toEqual({ error: "WORKSPACE_IMPORT_INVALID" });
    expect(valid.statusCode).toBe(200);
  });
});
