import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildResourceMap,
  createResourceTypeResolver,
  describeResponseSchemaTypes,
  type ResourceTypeResolver,
} from "./response-schema-types";

const appRoot = resolve("/work/app");
const userFile = resolve(appRoot, "src/app/users/resources/user.resource.ts");
const postFile = resolve(appRoot, "src/app/posts/resources/post.resource.tsx");

class UserResource {}
class PostResource {}

const resolver = (): ResourceTypeResolver =>
  createResourceTypeResolver(
    buildResourceMap([
      { file: userFile, namespace: { userResource: UserResource } },
      { file: postFile, namespace: { default: PostResource } },
    ]),
    appRoot,
  );

const cast = (name: string) => `import("@warlock.js/core").CastOutput<"${name}">`;
const USER = `import("@warlock.js/core").ResourceOutput<typeof import("../../src/app/users/resources/user.resource")["userResource"]>`;
const POST = `import("@warlock.js/core").ResourceOutput<typeof import("../../src/app/posts/resources/post.resource")["default"]>`;

describe("describeResponseSchemaTypes", () => {
  it("serializes casts, resources, nested objects and arrays per status", () => {
    const described = describeResponseSchemaTypes(
      {
        200: {
          body: {
            user: UserResource,
            token: "string",
            tags: "string[]?",
            meta: { count: "number" },
            posts: [PostResource],
          },
        },
        400: { body: { error: "string" } },
      },
      resolver(),
    );

    expect(described).toEqual({
      "200": `{ "user": ${USER}; "token": ${cast("string")}; "tags": ${cast("string[]?")}; "meta": { "count": ${cast("number")} }; "posts": (${POST})[] }`,
      "400": `{ "error": ${cast("string")} }`,
    });
  });

  it("JSON-quotes keys that are not identifiers", () => {
    const described = describeResponseSchemaTypes(
      { 200: { body: { "x-total": "int", 'we"ird': "string" } } },
      resolver(),
    );

    expect(described?.["200"]).toBe(
      `{ "x-total": ${cast("int")}; "we\\"ird": ${cast("string")} }`,
    );
  });

  it("types an unmapped resource as unknown and reports its path", () => {
    const Inline = class {};
    const onUnmapped = vi.fn();

    const described = describeResponseSchemaTypes(
      { 200: { body: { owner: Inline, items: [Inline], deep: { who: Inline } } } },
      resolver(),
      onUnmapped,
    );

    expect(described?.["200"]).toBe(
      `{ "owner": unknown; "items": (unknown)[]; "deep": { "who": unknown } }`,
    );
    expect(onUnmapped.mock.calls.map(([path]) => path)).toEqual([
      "200.body.owner",
      "200.body.items",
      "200.body.deep.who",
    ]);
  });

  it("renders an empty body as an empty object type", () => {
    expect(describeResponseSchemaTypes({ 204: { body: {} } }, resolver())).toEqual({ "204": "{}" });
  });

  it("returns undefined when nothing is declared", () => {
    expect(describeResponseSchemaTypes(undefined, resolver())).toBeUndefined();
    expect(describeResponseSchemaTypes({}, resolver())).toBeUndefined();
  });

  it("is deterministic: the same schema always yields the same strings", () => {
    const schema = { 200: { body: { user: UserResource, list: [PostResource] } } };

    expect(describeResponseSchemaTypes(schema, resolver())).toEqual(
      describeResponseSchemaTypes(schema, resolver()),
    );
  });
});

describe("buildResourceMap", () => {
  it("prefers a non-index file over a barrel re-export", () => {
    const map = buildResourceMap([
      { file: resolve(appRoot, "src/app/users/resources/index.ts"), namespace: { userResource: UserResource } },
      { file: userFile, namespace: { userResource: UserResource } },
    ]);

    expect(map.get(UserResource)).toEqual({ file: userFile, exportName: "userResource" });
  });

  it("prefers a named export over default, whichever comes first", () => {
    const named = buildResourceMap([
      { file: userFile, namespace: { default: UserResource, userResource: UserResource } },
    ]);
    const reversed = buildResourceMap([
      { file: userFile, namespace: { userResource: UserResource, default: UserResource } },
    ]);

    expect(named.get(UserResource)?.exportName).toBe("userResource");
    expect(reversed.get(UserResource)?.exportName).toBe("userResource");
  });

  it("ranks a default in a real file ahead of a named export in a barrel", () => {
    const map = buildResourceMap([
      { file: resolve(appRoot, "src/app/posts/resources/index.ts"), namespace: { postResource: PostResource } },
      { file: postFile, namespace: { default: PostResource } },
    ]);

    expect(map.get(PostResource)).toEqual({ file: postFile, exportName: "default" });
  });

  it("ignores non-function exports", () => {
    const value = { a: 1 };
    const map = buildResourceMap([{ file: userFile, namespace: { value, UserResource } }]);

    expect(map.has(value)).toBe(false);
    expect(map.size).toBe(1);
  });
});

describe("createResourceTypeResolver", () => {
  it("returns extensionless POSIX paths relative to .warlock/typings", () => {
    const resolveResource = resolver();

    expect(resolveResource(UserResource)).toEqual({
      importPath: "../../src/app/users/resources/user.resource",
      exportName: "userResource",
    });
    expect(resolveResource(PostResource)).toEqual({
      importPath: "../../src/app/posts/resources/post.resource",
      exportName: "default",
    });
    expect(resolveResource(class {})).toBeUndefined();
  });
});
