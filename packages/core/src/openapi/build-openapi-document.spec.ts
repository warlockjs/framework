import { lazy } from "@mongez/reinforcements";
import { v } from "@warlock.js/seal";
import { describe, expect, it } from "vitest";
import { nullable } from "../resource/nullable-resource";
import type { ResourceConstructor } from "../resource/resource";
import { buildOpenApiDocument } from "./build-openapi-document";
import type {
  OpenApiContext,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiResponse,
  OpenApiRouteInput,
  OpenApiSchema,
} from "./types";

const AUTH = Symbol.for("warlock.auth");
const info = { title: "Shop API", version: "1.2.3" };

type HandlerProps = {
  validation?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
  description?: string;
};

function handler(props: HandlerProps = {}): OpenApiRouteInput["handler"] {
  return Object.assign(() => undefined, props) as unknown as OpenApiRouteInput["handler"];
}

function guard(descriptor: unknown): NonNullable<OpenApiRouteInput["middleware"]> {
  const middleware = () => undefined;

  Object.defineProperty(middleware, AUTH, { value: descriptor });

  return [middleware];
}

function route(
  method: string,
  path: string,
  props: HandlerProps = {},
  extra: Partial<OpenApiRouteInput> = {},
): OpenApiRouteInput {
  return { method: method as OpenApiRouteInput["method"], path, handler: handler(props), ...extra };
}

function build(routes: OpenApiRouteInput[], context: Partial<OpenApiContext> = {}) {
  return buildOpenApiDocument(routes, { info, ...context });
}

/**
 * Return `value`, or throw when a lookup missed so the spec fails loudly instead of narrowing with `!`.
 */
function defined<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${description} to be defined.`);
  }

  return value;
}

function pathItem(document: OpenApiDocument, path: string): Record<string, OpenApiOperation> {
  return defined(document.paths[path], `path item "${path}"`);
}

function opAt(document: OpenApiDocument, path: string, method: string): OpenApiOperation {
  return defined(pathItem(document, path)[method], `${method} operation of "${path}"`);
}

function responseOf(op: OpenApiOperation, status: string): OpenApiResponse {
  return defined(op.responses[status], `${status} response`);
}

function jsonSchemaOf(content: OpenApiResponse["content"]): OpenApiSchema {
  return defined(content?.["application/json"], "application/json content").schema;
}

function operation(
  routes: OpenApiRouteInput[],
  path: string,
  method: string,
  context: Partial<OpenApiContext> = {},
): OpenApiOperation {
  return opAt(build(routes, context).document, path, method);
}

class UserResource {
  public static schema = {
    id: "number",
    name: "string",
    email: "string?",
    createdAt: "date",
    avatar: "url?",
    tags: "string[]",
    parent: "self",
    friends: "self[]",
  };
}

describe("buildOpenApiDocument — document shell", () => {
  it("emits 3.1.0 with the 2020-12 dialect, info, servers and tags", () => {
    const { document, warnings } = build([route("GET", "/users")], {
      servers: ["http://localhost:3000"],
    });

    expect(document).toEqual({
      openapi: "3.1.0",
      jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
      info,
      servers: [{ url: "http://localhost:3000" }],
      tags: [{ name: "users" }],
      paths: {
        "/users": {
          get: {
            operationId: "get_users",
            tags: ["users"],
            responses: { "200": { description: "Successful response" } },
          },
        },
      },
    });
    expect(warnings).toEqual([]);
  });

  it("omits servers, tags and components when there is nothing to put in them", () => {
    const { document } = build([route("GET", "/")]);

    expect(document).not.toHaveProperty("servers");
    expect(document).not.toHaveProperty("tags");
    expect(document).not.toHaveProperty("components");
  });

  it("produces plain JSON", () => {
    const { document } = build([
      route("POST", "/login", {
        validation: { schema: v.object({ email: v.string().required() }) },
        responseSchema: { 200: { body: { user: UserResource } } },
      }),
    ]);

    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });
});

describe("buildOpenApiDocument — paths and operations", () => {
  it("converts :param segments to {param} and adds string path parameters", () => {
    const { document } = build([route("GET", "/users/:id/posts/:postId")]);

    expect(opAt(document, "/users/{id}/posts/{postId}", "get").parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { name: "postId", in: "path", required: true, schema: { type: "string" } },
    ]);
  });

  it("expands an all route into every verb with a unique operationId", () => {
    const { document } = build([route("all", "/ping", {}, { name: "ping" })]);

    expect(Object.keys(pathItem(document, "/ping"))).toEqual([
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "options",
      "head",
    ]);
    expect(opAt(document, "/ping", "patch").operationId).toBe("ping.patch");
    expect(new Set(Object.values(pathItem(document, "/ping")).map((op) => op.operationId)).size).toBe(7);
  });

  it("keeps a route name as operationId and slugs unnamed routes", () => {
    const { document } = build([
      route("GET", "/users/:id", {}, { name: "users.show" }),
      route("DELETE", "/users/:id"),
    ]);

    expect(opAt(document, "/users/{id}", "get").operationId).toBe("users.show");
    expect(opAt(document, "/users/{id}", "delete").operationId).toBe("delete_users_id");
  });

  it("renames a duplicate operationId and says so", () => {
    const { document, warnings } = build([
      route("GET", "/a", {}, { name: "same" }),
      route("GET", "/b", {}, { name: "same" }),
    ]);

    expect(opAt(document, "/b", "get").operationId).toBe("same_2");
    expect(warnings).toEqual(['GET /b: operationId "same" is already used; renamed to "same_2".']);
  });

  it("skips a second route on the same path and method", () => {
    const { document, warnings } = build([route("GET", "/a"), route("GET", "/a")]);

    expect(Object.keys(pathItem(document, "/a"))).toEqual(["get"]);
    expect(warnings).toHaveLength(1);
  });

  it("uses label as summary and the route or handler description as description", () => {
    const fromRoute = operation(
      [
        route(
          "GET",
          "/a",
          { description: "handler text" },
          { label: "List", description: "route text" },
        ),
      ],
      "/a",
      "get",
    );
    const fromHandler = operation([route("GET", "/b", { description: "handler text" })], "/b", "get");

    expect(fromRoute.summary).toBe("List");
    expect(fromRoute.description).toBe("route text");
    expect(fromHandler.description).toBe("handler text");
    expect(fromHandler).not.toHaveProperty("summary");
  });

  it("tags by the first path segment and skips a leading parameter", () => {
    const { document } = build([route("GET", "/orders/:id"), route("GET", "/:slug")]);

    expect(opAt(document, "/orders/{id}", "get").tags).toEqual(["orders"]);
    expect(opAt(document, "/{slug}", "get")).not.toHaveProperty("tags");
  });

  it("excludes page routes unless includePages is set", () => {
    const routes = [route("GET", "/api/x"), route("GET", "/about", {}, { isPage: true })];

    expect(Object.keys(build(routes).document.paths)).toEqual(["/api/x"]);

    const included = opAt(build(routes, { includePages: true }).document, "/about", "get");

    expect(included.responses["200"]).toEqual({
      description: "HTML page",
      content: { "text/html": { schema: { type: "string" } } },
    });
  });

  it("skips an unsupported method with a warning", () => {
    const { document, warnings } = build([route("TRACE", "/x")]);

    expect(document.paths).toEqual({});
    expect(warnings).toEqual(['TRACE /x: unsupported method "TRACE", route skipped.']);
  });
});

describe("buildOpenApiDocument — request schemas", () => {
  const schema = v.object({
    name: v.string().required(),
    page: v.int().optional(),
  });

  it("puts an unscoped schema in the body for POST, PUT and PATCH", () => {
    for (const method of ["POST", "PUT", "PATCH"]) {
      const op = operation(
        [route(method, "/a", { validation: { schema } })],
        "/a",
        method.toLowerCase(),
      );

      expect(op.requestBody).toEqual({
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { name: { type: "string" }, page: { type: "integer" } },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
      });
      expect(op).not.toHaveProperty("parameters");
    }
  });

  it("puts an unscoped schema in query parameters for GET, HEAD and DELETE", () => {
    for (const method of ["GET", "HEAD", "DELETE"]) {
      const op = operation(
        [route(method, "/a", { validation: { schema } })],
        "/a",
        method.toLowerCase(),
      );

      expect(op.parameters).toEqual([
        { name: "name", in: "query", required: true, schema: { type: "string" } },
        { name: "page", in: "query", required: false, schema: { type: "integer" } },
      ]);
      expect(op).not.toHaveProperty("requestBody");
    }
  });

  it("turns a property named like a path segment into a path parameter", () => {
    const op = operation(
      [
        route("PUT", "/users/:id", {
          validation: { schema: v.object({ id: v.int().required(), name: v.string().required() }) },
        }),
      ],
      "/users/{id}",
      "put",
    );

    expect(op.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "integer" } },
    ]);
    expect(
      (jsonSchemaOf(defined(op.requestBody, "request body").content) as { properties: object }).properties,
    ).toEqual({ name: { type: "string" } });
  });

  it("validating ['body'] keeps a path-named property in the body and adds a string path parameter", () => {
    const op = operation(
      [
        route("PUT", "/users/:id", {
          validation: { validating: ["body"], schema: v.object({ id: v.int().required() }) },
        }),
      ],
      "/users/{id}",
      "put",
    );

    expect(op.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);
    expect(op.requestBody).toBeDefined();
  });

  it("validating ['query'] documents query parameters even for POST", () => {
    const op = operation(
      [route("POST", "/a", { validation: { validating: ["query"], schema } })],
      "/a",
      "post",
    );

    expect(op.parameters?.map((parameter) => parameter.in)).toEqual(["query", "query"]);
    expect(op).not.toHaveProperty("requestBody");
  });

  it("validating ['headers'] documents lowercase header parameters", () => {
    const op = operation(
      [
        route("GET", "/a", {
          validation: {
            validating: ["headers"],
            schema: v.object({ "X-Trace": v.string().required() }),
          },
        }),
      ],
      "/a",
      "get",
    );

    expect(op.parameters).toEqual([
      { name: "x-trace", in: "header", required: true, schema: { type: "string" } },
    ]);
  });

  it("validating ['params'] only maps path-named properties and warns about the rest", () => {
    const { document, warnings } = build([
      route("GET", "/users/:id", {
        validation: {
          validating: ["params"],
          schema: v.object({ id: v.int().required(), extra: v.string().optional() }),
        },
      }),
    ]);

    expect(opAt(document, "/users/{id}", "get").parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "integer" } },
    ]);
    expect(warnings).toEqual([
      'GET /users/:id: validation.schema property "extra" is not a path parameter and is not documented.',
    ]);
  });

  it("validating ['body','query'] is the body for POST and query for GET, with a warning", () => {
    const post = build([
      route("POST", "/a", { validation: { validating: ["body", "query"], schema } }),
    ]);
    const get = build([
      route("GET", "/a", { validation: { validating: ["body", "query"], schema } }),
    ]);

    expect(opAt(post.document, "/a", "post").requestBody).toBeDefined();
    expect(opAt(get.document, "/a", "get").parameters).toHaveLength(2);
    expect(post.warnings[0]).toContain("the request body");
    expect(get.warnings[0]).toContain("query parameters");
  });

  it("documents a params schema as typed required path parameters", () => {
    const op = operation(
      [
        route("GET", "/orders/:orderId/items/:sku", {
          validation: { params: v.object({ orderId: v.int().required() }) },
        }),
      ],
      "/orders/{orderId}/items/{sku}",
      "get",
    );

    expect(op.parameters).toEqual([
      { name: "orderId", in: "path", required: true, schema: { type: "integer" } },
      { name: "sku", in: "path", required: true, schema: { type: "string" } },
    ]);
  });

  it("a params schema wins over the same property in the main schema", () => {
    const op = operation(
      [
        route("GET", "/users/:id", {
          validation: {
            params: v.object({ id: v.int().required() }),
            schema: v.object({ id: v.string().required(), q: v.string().optional() }),
          },
        }),
      ],
      "/users/{id}",
      "get",
    );

    expect(op.parameters?.[0]).toEqual({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "integer" },
    });
    expect(op.parameters?.map((parameter) => parameter.name)).toEqual(["id", "q"]);
  });

  it("uses deepObject for a nested object query parameter", () => {
    const op = operation(
      [
        route("GET", "/a", {
          validation: {
            schema: v.object({ filter: v.object({ status: v.string().optional() }).required() }),
          },
        }),
      ],
      "/a",
      "get",
    );

    expect(op.parameters?.[0]).toMatchObject({
      name: "filter",
      in: "query",
      required: true,
      style: "deepObject",
      explode: true,
    });
  });

  it("warns about a custom validate middleware", () => {
    const { warnings } = build([route("POST", "/a", { validation: { validate: () => undefined } })]);

    expect(warnings).toEqual([
      "POST /a: validation.validate is custom middleware and is not documented.",
    ]);
  });

  it("survives a schema that cannot be converted and says so", () => {
    const broken = {
      toJsonSchema: () => {
        throw new Error("computed validators have no schema");
      },
    };
    const { document, warnings } = build([route("POST", "/a", { validation: { schema: broken } })]);

    expect(opAt(document, "/a", "post")).not.toHaveProperty("requestBody");
    expect(opAt(document, "/a", "post").responses).toHaveProperty("422");
    expect(warnings).toEqual([
      "POST /a: validation.schema could not be converted to JSON Schema and is not documented: computed validators have no schema",
    ]);
  });
});

describe("buildOpenApiDocument — responses from responseSchema", () => {
  it("documents only a 200 description when nothing is declared", () => {
    expect(operation([route("GET", "/a")], "/a", "get").responses).toEqual({
      "200": { description: "Successful response" },
    });
  });

  it("maps casts, nested objects and nullable / array suffixes", () => {
    const op = operation(
      [
        route("POST", "/a", {
          responseSchema: {
            200: {
              body: {
                token: "string",
                expiresAt: "number?",
                tags: "string[]",
                meta: { count: "int", next: "string[]?" },
                site: "url",
                joined: "date",
              },
            },
          },
        }),
      ],
      "/a",
      "post",
    );

    expect(op.responses["200"]).toEqual({
      description: "Successful response",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              token: { type: "string" },
              expiresAt: { type: ["number", "null"] },
              tags: { type: "array", items: { type: "string" } },
              meta: {
                type: "object",
                properties: {
                  count: { type: "integer" },
                  next: { type: ["array", "null"], items: { type: "string" } },
                },
                required: ["count", "next"],
              },
              site: { type: "string", format: "uri" },
              joined: {
                type: "object",
                properties: {
                  iso: { type: "string", format: "date-time" },
                  format: { type: "string" },
                  timestamp: { type: "number" },
                  humanTime: { type: "string" },
                },
                required: ["iso", "format", "timestamp", "humanTime"],
              },
            },
            required: ["token", "expiresAt", "tags", "meta", "site", "joined"],
          },
        },
      },
    });
  });

  it("emits a resource once in components.schemas and references it with $ref", () => {
    const { document } = build(
      [
        route("GET", "/me", { responseSchema: { 200: { body: { user: UserResource } } } }),
        route("GET", "/users", { responseSchema: { 200: { body: { users: [UserResource] } } } }),
      ],
      {
        resolveResourceName: (resource) => (resource === UserResource ? "UserResource" : undefined),
      },
    );
    const ref = { $ref: "#/components/schemas/UserResource" };

    expect(jsonSchemaOf(responseOf(opAt(document, "/me", "get"), "200").content)).toEqual({
      type: "object",
      properties: { user: ref },
      required: ["user"],
    });
    expect(
      jsonSchemaOf(responseOf(opAt(document, "/users", "get"), "200").content),
    ).toEqual({
      type: "object",
      properties: { users: { type: "array", items: ref } },
      required: ["users"],
    });
    expect(document.components?.schemas?.UserResource).toEqual({
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        email: { type: ["string", "null"] },
        createdAt: expect.objectContaining({
          type: "object",
          required: ["iso", "format", "timestamp", "humanTime"],
        }),
        avatar: { type: ["string", "null"], format: "uri" },
        tags: { type: "array", items: { type: "string" } },
        parent: ref,
        friends: { type: "array", items: ref },
      },
      required: ["id", "name", "email", "createdAt", "avatar", "tags", "parent", "friends"],
    });
  });

  it("documents nullable(Resource) in a response body as oneOf the resource or null", () => {
    const asResource = (value: unknown) => value as ResourceConstructor;
    const { document, warnings } = build(
      [
        route("GET", "/me", {
          responseSchema: {
            200: {
              body: {
                user: nullable(asResource(UserResource)),
                meta: { owner: nullable(asResource(UserResource)) },
              },
            },
          },
        }),
      ],
      { resolveResourceName: (resource) => (resource === UserResource ? "UserResource" : undefined) },
    );
    const nullableUser = {
      oneOf: [{ $ref: "#/components/schemas/UserResource" }, { type: "null" }],
    };

    expect(jsonSchemaOf(responseOf(opAt(document, "/me", "get"), "200").content)).toEqual({
      type: "object",
      properties: {
        user: nullableUser,
        meta: { type: "object", properties: { owner: nullableUser }, required: ["owner"] },
      },
      required: ["user", "meta"],
    });
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(["UserResource"]);
    expect(warnings).toEqual([]);
  });

  it("documents nullable(Resource) and [Resource] fields inside a resource", () => {
    const asResource = (value: unknown) => value as ResourceConstructor;

    class TagResource {
      public static schema = { label: "string" };
    }

    class PostResource {
      public static schema = {
        tags: [TagResource],
        author: nullable(asResource(UserResource)),
        editor: nullable(lazy(() => asResource(TagResource))),
      };
    }

    const { document, warnings } = build(
      [route("GET", "/p", { responseSchema: { 200: { body: { post: PostResource } } } })],
      {
        resolveResourceName: (resource) =>
          resource === PostResource
            ? "PostResource"
            : resource === TagResource
              ? "TagResource"
              : resource === UserResource
                ? "UserResource"
                : undefined,
      },
    );

    expect(document.components?.schemas?.PostResource).toEqual({
      type: "object",
      properties: {
        tags: { type: "array", items: { $ref: "#/components/schemas/TagResource" } },
        author: {
          oneOf: [{ $ref: "#/components/schemas/UserResource" }, { type: "null" }],
        },
        editor: {
          oneOf: [{ $ref: "#/components/schemas/TagResource" }, { type: "null" }],
        },
      },
      required: ["tags", "author", "editor"],
    });
    expect(warnings).toEqual([]);
  });

  it("recurses through nested and lazy resources without looping", () => {
    class CommentResource {
      public static schema: Record<string, unknown> = {
        body: "string",
        post: lazy(() => PostWithComments),
      };
    }

    class PostWithComments {
      public static schema: Record<string, unknown> = {
        first: CommentResource,
      };
    }

    const { document, warnings } = build(
      [route("GET", "/a", { responseSchema: { 200: { body: { comment: CommentResource } } } })],
      {
        resolveResourceName: (resource) =>
          resource === CommentResource ? "CommentResource" : "PostWithComments",
      },
    );

    expect(document.components?.schemas?.CommentResource).toMatchObject({
      properties: { post: { $ref: "#/components/schemas/PostWithComments" } },
    });
    expect(document.components?.schemas?.PostWithComments).toMatchObject({
      properties: { first: { $ref: "#/components/schemas/CommentResource" } },
    });
    expect(warnings).toEqual([]);
  });

  it("falls back to ResourceN when neither the resolver nor the class has a name", () => {
    const first = (() => class {})();
    const second = (() => class {})();

    Object.defineProperty(first, "name", { value: "" });
    Object.defineProperty(second, "name", { value: "" });
    Object.assign(first, { schema: { a: "string" } });
    Object.assign(second, { schema: { b: "string" } });

    const { document } = build([
      route("GET", "/a", { responseSchema: { 200: { body: { one: first, two: second } } } }),
    ]);

    expect(Object.keys(document.components?.schemas ?? {})).toEqual(["Resource1", "Resource2"]);
  });

  it("gives two resources that resolve to the same name distinct components", () => {
    class Other {
      public static schema = { x: "string" };
    }

    const { document } = build(
      [route("GET", "/a", { responseSchema: { 200: { body: { a: UserResource, b: Other } } } })],
      { resolveResourceName: () => "Same" },
    );

    expect(Object.keys(document.components?.schemas ?? {})).toEqual(["Same", "Same2"]);
  });

  it("documents builder fields, resolver functions and unknown casts as {} with a warning", () => {
    class Builderish {
      public transform() {
        return undefined;
      }

      public getInputKey() {
        return undefined;
      }
    }

    class MessyResource {
      public static schema = {
        computed: (value: unknown) => value,
        styled: new Builderish(),
        weird: "money",
        ok: "string",
      };
    }

    const { document, warnings } = build(
      [
        route("GET", "/a", {
          responseSchema: {
            200: { body: { fn: (value: unknown) => value, shape: MessyResource } },
          },
        }),
      ],
      { resolveResourceName: () => "MessyResource" },
    );

    expect(document.components?.schemas?.MessyResource).toEqual({
      type: "object",
      properties: { computed: {}, styled: {}, weird: {}, ok: { type: "string" } },
      required: ["computed", "styled", "weird", "ok"],
    });
    expect(warnings).toEqual([
      "GET /a: response 200.fn: a function that is not a resource class has no static shape and is documented as {}.",
      "MessyResource.computed: a resolver function has no static shape and is documented as {}.",
      "MessyResource.styled: a field builder has no static shape and is documented as {}. Declare it with a cast string to document it.",
      'MessyResource.weird: unknown cast "money" is documented as {}.',
    ]);
  });

  it("documents arrayOf fields as arrays of inline objects", () => {
    class Order {
      public static schema = {
        lines: { __type: "arrayOf", schema: { sku: "string", qty: "int" } },
      };
    }

    const { document } = build([
      route("GET", "/a", { responseSchema: { 200: { body: { order: Order } } } }),
    ]);

    expect(document.components?.schemas?.Order).toMatchObject({
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { sku: { type: "string" }, qty: { type: "integer" } },
          },
        },
      },
    });
  });

  it("adds a 200 description when only error statuses are declared", () => {
    const op = operation(
      [route("GET", "/a", { responseSchema: { 404: { body: { error: "string" } } } })],
      "/a",
      "get",
    );

    expect(Object.keys(op.responses)).toEqual(["200", "404"]);
    expect(responseOf(op, "404").description).toBe("Not found");
  });

  it("a declared status without a body is description-only", () => {
    const op = operation([route("DELETE", "/a", { responseSchema: { 204: {} } })], "/a", "delete");

    expect(op.responses).toEqual({ "204": { description: "No content" } });
  });
});

describe("buildOpenApiDocument — automatic 422 and 401", () => {
  const validation = { schema: v.object({ email: v.string().required() }) };

  it("adds 422 with the default failed-validation shape when validation.schema exists", () => {
    const { document } = build([route("POST", "/a", { validation })]);

    expect(opAt(document, "/a", "post").responses["422"]).toEqual({
      description: "Validation failed",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ValidationFailed" } },
      },
    });
    expect(document.components?.schemas?.ValidationFailed).toEqual({
      type: "object",
      properties: {
        errors: {
          type: "array",
          items: {
            type: "object",
            properties: { input: { type: "string" }, error: { type: "string" } },
            required: ["input", "error"],
          },
        },
      },
      required: ["errors"],
    });
  });

  it("honours the validation.response config keys and status", () => {
    const { document } = build([route("POST", "/a", { validation })], {
      validationResponse: {
        errors: "problems",
        inputKey: "field",
        inputError: "message",
        status: 400,
      },
    });

    expect(Object.keys(opAt(document, "/a", "post").responses)).toEqual(["200", "400"]);
    expect(document.components?.schemas?.ValidationFailed).toMatchObject({
      properties: {
        problems: {
          items: { properties: { field: { type: "string" }, message: { type: "string" } } },
        },
      },
      required: ["problems"],
    });
  });

  it("does not add 422 without validation.schema and keeps a declared 422", () => {
    expect(operation([route("POST", "/a")], "/a", "post").responses).not.toHaveProperty("422");

    const declared = operation(
      [route("POST", "/b", { validation, responseSchema: { 422: { body: { custom: "string" } } } })],
      "/b",
      "post",
    );

    expect(jsonSchemaOf(responseOf(declared, "422").content)).toMatchObject({
      properties: { custom: { type: "string" } },
    });
  });

  it("adds 401 for a guarded route and not for one with plain middleware", () => {
    const guarded = build([
      route("GET", "/a", {}, { middleware: guard({ sources: ["header"], userTypes: [] }) }),
    ]);
    const plain = build([route("GET", "/a", {}, { middleware: [() => undefined] })]);

    expect(opAt(guarded.document, "/a", "get").responses["401"]).toEqual({
      description: "Unauthorized",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Unauthorized" } } },
    });
    expect(guarded.document.components?.schemas?.Unauthorized).toEqual({
      type: "object",
      properties: { error: { type: "string" } },
      required: ["error"],
    });
    expect(opAt(plain.document, "/a", "get").responses).not.toHaveProperty("401");
    expect(plain.warnings).toEqual([]);
  });
});

describe("buildOpenApiDocument — security from the warlock.auth descriptor", () => {
  it("header source -> bearerAuth", () => {
    const { document } = build([
      route("GET", "/a", {}, { middleware: guard({ sources: ["header"], userTypes: [] }) }),
    ]);

    expect(opAt(document, "/a", "get").security).toEqual([{ bearerAuth: [] }]);
    expect(document.components?.securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    });
  });

  it("cookie source -> cookieAuth with the cookie name, and only the used scheme", () => {
    const { document } = build([
      route(
        "POST",
        "/a",
        {},
        { middleware: guard({ sources: [{ cookie: "session" }], userTypes: ["admin"] }) },
      ),
    ]);

    expect(opAt(document, "/a", "post").security).toEqual([{ cookieAuth: [] }]);
    expect(document.components?.securitySchemes).toEqual({
      cookieAuth: { type: "apiKey", in: "cookie", name: "session" },
    });
    expect(opAt(document, "/a", "post").description).toBe(
      "Requires an authenticated user of type: admin.\n\nWhen authenticating with the cookie, the request must also carry a same-origin Origin or Referer header (CSRF guard).",
    );
  });

  it("dual header + cookie -> an OR list of requirements", () => {
    const { document } = build([
      route(
        "GET",
        "/a",
        {},
        { middleware: guard({ sources: ["header", { cookie: "t" }], userTypes: [] }) },
      ),
    ]);

    expect(opAt(document, "/a", "get").security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(Object.keys(document.components?.securitySchemes ?? {})).toEqual([
      "bearerAuth",
      "cookieAuth",
    ]);
    expect(opAt(document, "/a", "get")).not.toHaveProperty("description");
  });

  it("gives a second, different cookie its own scheme", () => {
    const { document } = build([
      route("GET", "/a", {}, { middleware: guard({ sources: [{ cookie: "one" }], userTypes: [] }) }),
      route("GET", "/b", {}, { middleware: guard({ sources: [{ cookie: "two" }], userTypes: [] }) }),
    ]);

    expect(opAt(document, "/b", "get").security).toEqual([{ cookieAuth_two: [] }]);
    expect(document.components?.securitySchemes?.cookieAuth_two).toEqual({
      type: "apiKey",
      in: "cookie",
      name: "two",
    });
  });

  it("emits no components.securitySchemes when no route is guarded", () => {
    const { document } = build([route("GET", "/a", {}, { middleware: [() => undefined] })]);

    expect(document).not.toHaveProperty("components");
    expect(opAt(document, "/a", "get")).not.toHaveProperty("security");
  });

  it.each([
    ["not an object", "header"],
    ["no sources", { userTypes: [] }],
    ["empty sources", { sources: [], userTypes: [] }],
    ["a bad source", { sources: ["cookie"], userTypes: [] }],
    ["an empty cookie name", { sources: [{ cookie: "" }], userTypes: [] }],
    ["bad user types", { sources: ["header"], userTypes: [1] }],
  ])("ignores a malformed descriptor (%s) with a warning", (_label, descriptor) => {
    const { document, warnings } = build([
      route("GET", "/a", {}, { middleware: guard(descriptor) }),
    ]);

    expect(opAt(document, "/a", "get")).not.toHaveProperty("security");
    expect(opAt(document, "/a", "get").responses).not.toHaveProperty("401");
    expect(warnings).toEqual([
      "GET /a: a middleware carries a malformed warlock.auth descriptor; the route is documented without security.",
    ]);
  });

  it("accepts a descriptor without userTypes", () => {
    const { document } = build([
      route("GET", "/a", {}, { middleware: guard({ sources: ["header"] }) }),
    ]);

    expect(opAt(document, "/a", "get").security).toEqual([{ bearerAuth: [] }]);
  });

  it("merges several guards on one route", () => {
    const middleware = [
      ...guard({ sources: ["header"], userTypes: ["admin"] }),
      ...guard({ sources: ["header", { cookie: "t" }], userTypes: ["vendor"] }),
    ];
    const { document } = build([route("GET", "/a", {}, { middleware })]);

    expect(opAt(document, "/a", "get").security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(opAt(document, "/a", "get").description).toBe(
      "Requires an authenticated user of type: admin, vendor.",
    );
  });
});

describe("buildOpenApiDocument — small end to end fixture", () => {
  it("documents a guarded POST, a parameterised GET and an unnamed route", () => {
    const { document, warnings } = build(
      [
        route(
          "POST",
          "/login",
          {
            validation: {
              schema: v.object({
                email: v.string().email().required(),
                password: v.string().required(),
              }),
            },
            responseSchema: { 200: { body: { user: UserResource, token: "string" } } },
          },
          {
            name: "auth.login",
            label: "Log in",
            middleware: guard({ sources: ["header"], userTypes: [] }),
          },
        ),
        route(
          "GET",
          "/users/:id",
          { validation: { params: v.object({ id: v.int().required() }) } },
          { name: "users.show" },
        ),
        route("GET", "/health"),
      ],
      {
        servers: ["http://localhost:3000"],
        resolveResourceName: () => "UserResource",
      },
    );

    expect(document.paths).toEqual({
      "/login": {
        post: {
          operationId: "auth.login",
          summary: "Log in",
          tags: ["login"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                  },
                  required: ["email", "password"],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user: { $ref: "#/components/schemas/UserResource" },
                      token: { type: "string" },
                    },
                    required: ["user", "token"],
                  },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Unauthorized" } },
              },
            },
            "422": {
              description: "Validation failed",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ValidationFailed" } },
              },
            },
          },
          security: [{ bearerAuth: [] }],
        },
      },
      "/users/{id}": {
        get: {
          operationId: "users.show",
          tags: ["users"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Successful response" } },
        },
      },
      "/health": {
        get: {
          operationId: "get_health",
          tags: ["health"],
          responses: { "200": { description: "Successful response" } },
        },
      },
    });
    expect(Object.keys(document.components?.schemas ?? {})).toEqual([
      "UserResource",
      "ValidationFailed",
      "Unauthorized",
    ]);
    expect(document.components?.securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    });
    expect(warnings).toEqual([]);
  });
});
