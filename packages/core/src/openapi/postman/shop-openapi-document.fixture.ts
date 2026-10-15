import type { OpenApiDocument } from "../types";

/**
 * The OpenAPI document the Postman golden spec converts: a guarded JSON POST with a resource
 * response, a guarded GET with a path parameter and query, an untagged public route with a
 * header parameter, a multipart upload and a cookie-only route.
 */
export const shopOpenApiDocument: OpenApiDocument = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: { title: "Shop API", version: "1.2.3", description: "The shop backend." },
  servers: [{ url: "https://api.shop.test/" }],
  tags: [{ name: "media" }, { name: "users" }],
  paths: {
    "/users": {
      post: {
        operationId: "users.create",
        summary: "Create a user",
        description: "Creates a user.\n\nRequires an authenticated user of type: admin.",
        tags: ["users"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  email: { type: "string", format: "email" },
                  name: { type: "string" },
                  role: { enum: ["admin", "member"] },
                  age: { type: ["integer", "null"] },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["email", "name"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/UserResource" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Unauthorized" } } },
          },
          "422": {
            description: "Validation failed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationFailed" } } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/users/{id}": {
      get: {
        operationId: "users.show",
        summary: "Show a user",
        tags: ["users"],
        parameters: [
          { name: "id", in: "path", required: true, description: "The user id.", schema: { type: "integer" } },
          { name: "include", in: "query", description: "Related data to embed.", schema: { enum: ["posts", "orders"] } },
          { name: "page", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
        ],
        responses: {
          "200": {
            description: "Successful response",
            content: { "application/json": { schema: { $ref: "#/components/schemas/UserResource" } } },
          },
          "404": { description: "Not found" },
        },
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
      },
    },
    "/health": {
      get: {
        operationId: "health",
        parameters: [{ name: "x-request-id", in: "header", description: "Correlation id.", schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { const: "ok" }, checkedAt: { type: "string", format: "date-time" } },
                  required: ["status", "checkedAt"],
                },
              },
            },
          },
        },
      },
    },
    "/avatars": {
      post: {
        operationId: "avatars.upload",
        summary: "Upload an avatar",
        tags: ["media"],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary", description: "PNG or JPEG." },
                  caption: { type: "string" },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: { "204": { description: "No content" } },
        security: [{ bearerAuth: [] }],
      },
    },
    "/me": {
      get: {
        operationId: "me",
        summary: "Current user",
        description: "Returns the signed-in user.",
        responses: {
          "200": {
            description: "Successful response",
            content: { "application/json": { schema: { $ref: "#/components/schemas/UserResource" } } },
          },
        },
        security: [{ cookieAuth: [] }],
      },
    },
  },
  components: {
    schemas: {
      UserResource: {
        type: "object",
        properties: {
          id: { type: "number" },
          name: { type: "string" },
          email: { type: ["string", "null"] },
          avatar: { type: "string", format: "uri" },
          createdAt: {
            type: "object",
            properties: {
              iso: { type: "string", format: "date-time" },
              format: { type: "string" },
              timestamp: { type: "number" },
              humanTime: { type: "string" },
            },
            required: ["iso", "format", "timestamp", "humanTime"],
          },
          parent: { $ref: "#/components/schemas/UserResource" },
          friends: { type: "array", items: { $ref: "#/components/schemas/UserResource" } },
        },
        required: ["id", "name", "email", "avatar", "createdAt", "parent", "friends"],
      },
      Unauthorized: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      ValidationFailed: {
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
      },
    },
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      cookieAuth: { type: "apiKey", in: "cookie", name: "session" },
    },
  },
};
