import { readFileSync } from "node:fs";
import path from "node:path";
import { v } from "@warlock.js/seal";
import { describe, expect, it } from "vitest";
import { shopOpenApiDocument } from "./shop-openapi-document.fixture";
import { buildOpenApiDocument } from "../build-openapi-document";
import type { OpenApiRouteInput } from "../types";
import { openApiToPostmanCollection } from "./openapi-to-postman-collection";
import type { PostmanFolder, PostmanItem, PostmanRequestItem } from "./postman-types";

const goldenPath = path.resolve(__dirname, "../../../tests/fixtures/postman/shop-collection.golden.json");

function isFolder(item: PostmanItem): item is PostmanFolder {
  return "item" in item;
}

function defined<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${description} to be defined.`);
  }

  return value;
}

function requestNamed(items: PostmanItem[], name: string): PostmanRequestItem {
  for (const item of items) {
    if (isFolder(item)) {
      const nested = item.item.find((child) => !isFolder(child) && child.name === name);

      if (nested && !isFolder(nested)) {
        return nested;
      }
    } else if (item.name === name) {
      return item;
    }
  }

  throw new Error(`No request named "${name}".`);
}

describe("openApiToPostmanCollection", () => {
  it("matches the golden collection for the shop document", () => {
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

    expect(openApiToPostmanCollection(shopOpenApiDocument)).toEqual(golden);
  });

  it("is plain, stable JSON", () => {
    const collection = openApiToPostmanCollection(shopOpenApiDocument);

    expect(JSON.parse(JSON.stringify(collection))).toEqual(collection);
    expect(JSON.stringify(openApiToPostmanCollection(shopOpenApiDocument))).toBe(JSON.stringify(collection));
  });

  it("derives a deterministic _postman_id from the title", () => {
    const first = openApiToPostmanCollection(shopOpenApiDocument).info._postman_id;
    const renamed = openApiToPostmanCollection(shopOpenApiDocument, { title: "Other" }).info;

    expect(first).toBe("d1a019af-c9f0-5f47-a37b-818d2d480f0f");
    expect(renamed.name).toBe("Other");
    expect(renamed._postman_id).not.toBe(first);
  });

  it("puts one folder per tag by first appearance and leaves untagged operations at the root", () => {
    const { item } = openApiToPostmanCollection(shopOpenApiDocument);

    expect(item.map((entry) => `${isFolder(entry) ? "folder" : "request"}:${entry.name}`)).toEqual([
      "folder:users",
      "request:health",
      "folder:media",
      "request:Current user",
    ]);
  });

  it("names a request by summary, else operationId, and converts {id} to :id", () => {
    const { item } = openApiToPostmanCollection(shopOpenApiDocument);
    const show = requestNamed(item, "Show a user");
    const health = requestNamed(item, "health");

    expect(show.request.url.path).toEqual(["users", ":id"]);
    expect(show.request.url.variable).toEqual([{ key: "id", value: "", description: "The user id." }]);
    expect(health.request.method).toBe("GET");
  });

  it("emits only enabled query rows in raw and disables optional ones", () => {
    const { url } = requestNamed(openApiToPostmanCollection(shopOpenApiDocument).item, "Show a user").request;

    expect(url.raw).toBe("{{baseUrl}}/users/:id?page=");
    expect(url.query).toEqual([
      { key: "include", value: "posts", description: "Related data to embed.", disabled: true },
      { key: "page", value: "" },
    ]);
  });

  it("sends a JSON body with a Content-Type header and a generated example", () => {
    const { request } = requestNamed(openApiToPostmanCollection(shopOpenApiDocument).item, "Create a user");

    expect(request.header).toEqual([{ key: "Content-Type", value: "application/json", type: "text" }]);
    expect(request.body).toMatchObject({ mode: "raw", options: { raw: { language: "json" } } });
    expect(request.body && "raw" in request.body ? JSON.parse(request.body.raw) : undefined).toEqual({
      email: "user@example.com",
      name: "string",
      role: "admin",
      age: 0,
      tags: ["string"],
    });
  });

  it("turns a multipart body into formdata with a file row and no explicit Content-Type", () => {
    const { request } = requestNamed(openApiToPostmanCollection(shopOpenApiDocument).item, "Upload an avatar");

    expect(request.header).toEqual([]);
    expect(request.body).toEqual({
      mode: "formdata",
      formdata: [
        { key: "file", type: "file", src: [], description: "PNG or JPEG." },
        { key: "caption", value: "string", type: "text" },
      ],
    });
  });

  it("turns a url-encoded body into urlencoded rows", () => {
    const document = structuredClone(shopOpenApiDocument);
    const operation = defined(document.paths["/users"]?.post, "POST /users");

    operation.requestBody = {
      content: {
        "application/x-www-form-urlencoded": {
          schema: { type: "object", properties: { name: { type: "string" } } },
        },
      },
    };

    const { request } = requestNamed(openApiToPostmanCollection(document).item, "Create a user");

    expect(request.body).toEqual({ mode: "urlencoded", urlencoded: [{ key: "name", value: "string", type: "text" }] });
  });

  it("saves one response per declared status with status text, code and an example body", () => {
    const { response } = requestNamed(openApiToPostmanCollection(shopOpenApiDocument).item, "Create a user");

    expect(response.map((saved) => [saved.code, saved.status])).toEqual([
      [201, "Created"],
      [401, "Unauthorized"],
      [422, "Unprocessable Entity"],
    ]);
    expect(JSON.parse(defined(response[2], "422 response").body)).toEqual({
      errors: [{ input: "string", error: "string" }],
    });
    expect(response[0]?.originalRequest.method).toBe("POST");
    expect(response[0]?.originalRequest).not.toHaveProperty("auth");
  });

  it("cuts the resource cycle in saved response bodies", () => {
    const { response } = requestNamed(openApiToPostmanCollection(shopOpenApiDocument).item, "Show a user");

    expect(JSON.parse(defined(response[0], "200 response").body)).toMatchObject({ id: 0, friends: [] });
    expect(JSON.parse(defined(response[0], "200 response").body)).not.toHaveProperty("parent");
  });

  it("uses collection bearer auth, opts public routes out, and notes cookie-only routes", () => {
    const collection = openApiToPostmanCollection(shopOpenApiDocument);

    expect(collection.auth).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "{{token}}", type: "string" }],
    });
    expect(requestNamed(collection.item, "Create a user").request).not.toHaveProperty("auth");
    expect(requestNamed(collection.item, "Show a user").request).not.toHaveProperty("auth");
    expect(requestNamed(collection.item, "health").request.auth).toEqual({ type: "noauth" });

    const me = requestNamed(collection.item, "Current user").request;

    expect(me.auth).toEqual({ type: "noauth" });
    expect(me.description).toContain('Authenticates with the "session" cookie');
    expect(me.description?.startsWith("Returns the signed-in user.")).toBe(true);
  });

  it("emits no collection auth and no per-request noauth when the document has no bearer scheme", () => {
    const document = structuredClone(shopOpenApiDocument);

    delete document.components?.securitySchemes?.bearerAuth;

    const collection = openApiToPostmanCollection(document);

    expect(collection).not.toHaveProperty("auth");
    expect(requestNamed(collection.item, "health").request).not.toHaveProperty("auth");
  });

  it("declares baseUrl (trailing slash trimmed) and an empty token", () => {
    expect(openApiToPostmanCollection(shopOpenApiDocument).variable).toEqual([
      { key: "baseUrl", value: "https://api.shop.test", type: "string" },
      { key: "token", value: "", type: "string" },
    ]);
  });

  it("falls back to localhost and honours the baseUrl and title options", () => {
    const { servers: _servers, ...withoutServers } = shopOpenApiDocument;

    expect(openApiToPostmanCollection(withoutServers).variable[0]?.value).toBe("http://localhost:3000");
    expect(openApiToPostmanCollection(shopOpenApiDocument, { baseUrl: "http://x.test:1/" }).variable[0]?.value).toBe(
      "http://x.test:1",
    );
  });

  it("converts a document built from real routes", () => {
    const middleware = () => undefined;

    Object.defineProperty(middleware, Symbol.for("warlock.auth"), { value: { sources: ["header"], userTypes: [] } });

    const handler = Object.assign(() => undefined, {
      validation: { schema: v.object({ email: v.string().required() }) },
    }) as unknown as OpenApiRouteInput["handler"];

    const { document } = buildOpenApiDocument(
      [
        { method: "POST", path: "/users", handler, middleware: [middleware] },
        { method: "GET", path: "/users/:id", handler: (() => undefined) as unknown as OpenApiRouteInput["handler"] },
      ],
      { info: { title: "App", version: "1.0.0" }, servers: ["http://localhost:2030"] },
    );

    const collection = openApiToPostmanCollection(document);
    const folder = defined(collection.item[0], "users folder");

    expect(isFolder(folder) && folder.name).toBe("users");
    expect(collection.auth?.type).toBe("bearer");
    expect(requestNamed(collection.item, "post_users").request.body).toMatchObject({ mode: "raw" });
    expect(requestNamed(collection.item, "get_users_id").request.url.raw).toBe("{{baseUrl}}/users/:id");
    expect(requestNamed(collection.item, "get_users_id").request.auth).toEqual({ type: "noauth" });
  });
});
