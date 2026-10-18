import type { Name } from "../utils/name-parser";
import type { EndpointField } from "../utils/endpoint-schema";

/**
 * Stubs for `warlock make endpoint`.
 *
 * Every stub follows the conventions `warlock check` enforces:
 * one controller per file, input read through `request.validated()` only,
 * the work done in a service that never sees the request, a resource for the
 * output, the response documented through `responseSchema` (OpenAPI), and a
 * mutating route that is either guarded or explicitly `public: true`.
 */

export type EndpointMethod = "get" | "post" | "put" | "patch" | "delete";

export type EndpointAccess = "guarded" | "public";

export type EndpointSpec = {
  /** Module folder name, e.g. `posts`. */
  module: string;
  /** The endpoint's name, e.g. `create-post`. */
  name: Name;
  method: EndpointMethod;
  /** Route path, e.g. `/posts` or `/posts/:id`. */
  path: string;
  access: EndpointAccess;
  /** The resource the endpoint answers with, e.g. `Post`. */
  resource: Name;
  /** Top-level request fields, read from the schema (empty without `--schema`). */
  fields: EndpointField[];
};

/** `POST /posts` — used in comments, test names and descriptions. */
export function endpointLabel(spec: EndpointSpec): string {
  return `${spec.method.toUpperCase()} ${spec.path}`;
}

/** The success status the controller answers with. */
export function endpointStatus(spec: EndpointSpec): 200 | 201 {
  return spec.method === "post" ? 201 : 200;
}

/** `createPostSuccess` — the locale key of the success message. */
export function successMessageKey(spec: EndpointSpec): string {
  return `${spec.name.camel}Success`;
}

/** `Create post completed successfully.` — the English success message. */
export function successMessage(spec: EndpointSpec): string {
  const words = spec.name.kebab.split("-").join(" ");

  return `${words.charAt(0).toUpperCase()}${words.slice(1)} completed successfully.`;
}

/** The key the resource sits under in the response body, e.g. `post`. */
export function resourceResponseKey(spec: EndpointSpec): string {
  return spec.resource.singular.camel;
}

/** `schema/<name>.schema.ts` when no `--schema` file was given. */
export function endpointSchemaStub(spec: EndpointSpec): string {
  return `import { type Infer, v } from "@warlock.js/seal";

/** Request input for ${endpointLabel(spec)}. */
export const ${spec.name.camel}Schema = v.object({
  // TODO: describe the request input, then run make endpoint again with --force
  // to regenerate the resource and test from it.
});

export type ${spec.name.pascal}Schema = Infer<typeof ${spec.name.camel}Schema>;
`;
}

/** `services/<name>.service.ts`. */
export function endpointServiceStub(spec: EndpointSpec): string {
  return `import type { ${spec.name.pascal}Schema } from "../schema/${spec.name.kebab}.schema";

/**
 * The work behind ${endpointLabel(spec)}. It takes validated input, never the
 * request, so a job, a command or another service can call it too.
 */
export async function ${spec.name.camel}Service(input: ${spec.name.pascal}Schema) {
  // TODO: persist or act on the input, then return what the endpoint answers with.
  return input;
}
`;
}

/** `resources/<resource>.resource.ts`, shaped from the request fields. */
export function endpointResourceStub(spec: EndpointSpec): string {
  const fields = spec.fields.filter((field) => field.cast !== undefined);
  const body =
    fields.length === 0
      ? '    // TODO: list the fields this resource outputs, e.g. id: "number"'
      : fields.map((field) => `    ${propertyKey(field.name)}: "${field.cast}",`).join("\n");

  return `import { defineResource } from "@warlock.js/core";

/** What ${spec.resource.pascal} looks like in a response. */
export const ${spec.resource.pascal}Resource = defineResource({
  schema: {
${body}
  },
});
`;
}

/** `controllers/<name>.controller.ts` — one handler per file. */
export function endpointControllerStub(spec: EndpointSpec): string {
  const resource = `${spec.resource.pascal}Resource`;
  const key = resourceResponseKey(spec);
  const status = endpointStatus(spec);
  const respond = status === 201 ? "successCreate" : "success";
  const controller = `${spec.name.camel}Controller`;
  const schemaType = `${spec.name.pascal}Schema`;
  const handlerType =
    spec.access === "guarded"
      ? `GuardedRequestHandler<${schemaType}>`
      : `RequestHandler<Request<${schemaType}>>`;
  const coreImport =
    spec.access === "guarded"
      ? `import { t } from "@warlock.js/core";
import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";`
      : `import { type Request, type RequestHandler, t } from "@warlock.js/core";`;

  return `${coreImport}
import { ${resource} } from "../resources/${spec.resource.singular.kebab}.resource";
import { type ${schemaType}, ${spec.name.camel}Schema } from "../schema/${spec.name.kebab}.schema";
import { ${spec.name.camel}Service } from "../services/${spec.name.kebab}.service";

/** ${endpointLabel(spec)} */
export const ${controller}: ${handlerType} = async ({
  request,
  response,
}) => {
  const ${key} = await ${spec.name.camel}Service(request.validated());

  return response.${respond}({
    message: t("${spec.module}.${successMessageKey(spec)}"),
    ${key}: new ${resource}(${key}),
  });
};

${controller}.description = "${successMessage(spec).replace(" completed successfully.", "")}";

${controller}.validation = {
  schema: ${spec.name.camel}Schema,
};

// Documents the success response for \`warlock generate.openapi\` and the typed route map.
${controller}.responseSchema = {
  ${status}: {
    body: {
      message: "string",
      ${key}: ${resource},
    },
  },
};
`;
}

/** The import lines a module `routes.ts` needs for this endpoint. */
export function endpointRouteImports(spec: EndpointSpec): string[] {
  const imports = [
    `import { ${spec.name.camel}Controller } from "./controllers/${spec.name.kebab}.controller";`,
  ];

  return imports;
}

/** The registration block appended to the module's `routes.ts`. */
export function endpointRouteRegistration(spec: EndpointSpec): string {
  const controller = `${spec.name.camel}Controller`;

  if (spec.access === "public") {
    return `// ${endpointLabel(spec)} — public on purpose: no auth guard.
router.${spec.method}("${spec.path}", ${controller}, { public: true });
`;
  }

  return `guarded(() => {
  router.${spec.method}("${spec.path}", ${controller});
});
`;
}

/** A fresh module `routes.ts` holding only this endpoint. */
export function endpointRoutesFileStub(spec: EndpointSpec): string {
  const imports = [`import { router } from "@warlock.js/core";`];

  if (spec.access === "guarded") {
    imports.push(`import { guarded } from "app/shared/utils/router";`);
  }

  imports.push(...endpointRouteImports(spec));

  return `${imports.join("\n")}

${endpointRouteRegistration(spec)}`;
}

/** The path the generated test requests: route params get a placeholder. */
export function endpointTestPath(spec: EndpointSpec): string {
  return spec.path.replace(/:[A-Za-z0-9_]+\??/g, "1");
}

/** The request input the generated test sends: every field JSON can carry. */
export function endpointSampleInput(spec: EndpointSpec): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  for (const field of spec.fields) {
    if (field.sample !== undefined) input[field.name] = field.sample;
  }

  return input;
}

/** The part of the input the response echoes unchanged. */
function comparableInput(spec: EndpointSpec): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  for (const field of spec.fields) {
    if (field.comparable) input[field.name] = field.sample;
  }

  return input;
}

/** A required field the test can drop to prove validation runs, if any. */
function droppableRequiredField(spec: EndpointSpec) {
  return spec.fields.find((field) => field.required && field.sample !== undefined);
}

/** Fields JSON cannot carry (files): the happy path needs multipart instead. */
function uncarriableRequiredFields(spec: EndpointSpec): string[] {
  return spec.fields
    .filter((field) => field.required && field.sample === undefined)
    .map((field) => field.name);
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** A TypeScript literal for a JSON value: unquoted identifier keys, trailing commas. */
function toLiteral(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    return `[\n${value.map((item) => `${indent}  ${toLiteral(item, `${indent}  `)},`).join("\n")}\n${indent}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);

    if (entries.length === 0) return "{}";

    return `{\n${entries
      .map(([key, item]) => `${indent}  ${propertyKey(key)}: ${toLiteral(item, `${indent}  `)},`)
      .join("\n")}\n${indent}}`;
  }

  return JSON.stringify(value);
}

function indentJson(value: unknown, indent: string): string {
  return toLiteral(value, indent);
}

/**
 * The statement that sends `inputExpression` to the endpoint, through
 * `client` (`testRequest`-shaped helpers or an `actingAs()` client).
 */
function sendRequest(spec: EndpointSpec, client: string, inputExpression: string): string {
  const path = JSON.stringify(endpointTestPath(spec));

  switch (spec.method) {
    case "get":
      return `${client === "" ? "testGet" : `${client}.get`}(${path} + "?" + new URLSearchParams(toQuery(${inputExpression})).toString())`;
    case "delete":
      return `${client === "" ? "testRequest" : `${client}.request`}(${path}, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(${inputExpression}),
    })`;
    default: {
      const helper = `test${spec.method.charAt(0).toUpperCase()}${spec.method.slice(1)}`;

      return `${client === "" ? helper : `${client}.${spec.method}`}(${path}, ${inputExpression})`;
    }
  }
}

/** The `@warlock.js/core/tests` helpers a test sends anonymous requests with. */
function anonymousHelpers(spec: EndpointSpec): string[] {
  switch (spec.method) {
    case "get":
      return ["testGet"];
    case "delete":
      return ["testRequest"];
    default:
      return [`test${spec.method.charAt(0).toUpperCase()}${spec.method.slice(1)}`];
  }
}

/**
 * `tests/<name>.test.ts` — requests the endpoint over the real HTTP stack
 * (the test server `warlock add test` wires up): routing, middleware,
 * validation, controller, resource and serialization all run.
 */
export function endpointTestStub(spec: EndpointSpec): string {
  const label = endpointLabel(spec);
  const key = resourceResponseKey(spec);
  const status = endpointStatus(spec);
  const input = endpointSampleInput(spec);
  const expected = comparableInput(spec);
  const dropped = droppableRequiredField(spec);
  const uncarriable = uncarriableRequiredFields(spec);
  const guarded = spec.access === "guarded";
  const needsQuery = spec.method === "get";
  const helpers = new Set<string>(["expectJson", ...anonymousHelpers(spec)]);

  if (guarded) helpers.add("actingAs");

  const lines: string[] = [];

  if (guarded) {
    lines.push(`import type { Auth } from "@warlock.js/auth";`);
    lines.push(`import type { ChildModel } from "@warlock.js/cascade";`);
    lines.push(`import { config } from "@warlock.js/core";`);
  }

  lines.push(`import { ${[...helpers].sort().join(", ")} } from "@warlock.js/core/tests";`);

  if (guarded) lines.push(`import { randomUUID } from "node:crypto";`);

  lines.push(
    `import { ${guarded ? "afterAll, describe, expect, it" : "describe, expect, it"} } from "vitest";`,
  );

  const header = `${lines.join("\n")}

/** A valid request for ${label}, derived from its schema. */
const validInput: Record<string, unknown> = ${indentJson(input, "")};
${
  needsQuery
    ? `
/** Query values travel as strings; numeric schema fields need \`.coerce()\`. */
function toQuery(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]));
}
`
    : ""
}`;

  const happyAssertions = (indent: string) =>
    [
      `const body = await expectJson<{ message: string; ${key}: Record<string, unknown> }>(`,
      `  response,`,
      `  ${status},`,
      `);`,
      ``,
      `expect(typeof body.message).toBe("string");`,
      `expect(body.${key}).toMatchObject(${indentJson(expected, indent)});`,
    ]
      .map((line, index) => (index === 0 || line === "" ? line : `${indent}${line}`))
      .join("\n");

  const dropStatement = dropped
    ? `const input = { ...validInput };

    delete input[${JSON.stringify(dropped.name)}];
`
    : "";

  const validationCase = dropped
    ? `
  it("rejects a request without ${dropped.name}", async () => {
    ${dropStatement}
    const response = await ${sendRequest(spec, "", "input")};

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
`
    : "";

  if (!guarded) {
    const happy =
      uncarriable.length > 0
        ? `  it.todo("answers a valid request — send ${uncarriable.join(", ")} as multipart form data (JSON cannot carry files)");\n`
        : `  it("answers a valid request with the ${spec.resource.singular.pascal} resource", async () => {
    const response = await ${sendRequest(spec, "", "validInput")};

    ${happyAssertions("    ")}
  });
`;

    return `${header}
describe("${label}", () => {
${happy}${validationCase}});
`;
  }

  const signedInHappy =
    uncarriable.length > 0
      ? `  it.todo("answers a signed-in user — send ${uncarriable.join(", ")} as multipart form data (JSON cannot carry files)");\n`
      : `  it("answers a signed-in user with the ${spec.resource.singular.pascal} resource", async () => {
    const client = await signIn();

    try {
      const response = await ${sendRequest(spec, "client", "validInput")};

      ${happyAssertions("      ")}
    } finally {
      await client.dispose();
    }
  });
`;

  const guardedValidation = dropped
    ? `
  it("rejects a request without ${dropped.name}", async () => {
    const client = await signIn();

    try {
      const input = { ...validInput };

      delete input[${JSON.stringify(dropped.name)}];

      const response = await ${sendRequest(spec, "client", "input")};

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    } finally {
      await client.dispose();
    }
  });
`
    : "";

  return `${header}
describe("${label}", () => {
  const users: Auth[] = [];

  /** A real user and a real access token; adjust the fields if your user model requires more. */
  async function signIn() {
    const User = config.key<ChildModel<Auth>>("auth.userType.user");

    if (!User) throw new Error("This test needs the configured auth.userType.user model.");

    const user = await User.create({
      name: "Endpoint test user",
      email: "endpoint-" + randomUUID() + "@example.test",
      password: "test-password",
    });

    users.push(user);

    return actingAs(user);
  }

  afterAll(async () => {
    await Promise.all(users.splice(0).map((user) => user.destroy({ strategy: "permanent" })));
  });

  it("rejects an anonymous request", async () => {
    const response = await ${sendRequest(spec, "", "validInput")};

    expect(response.status).toBe(401);
  });

${signedInHappy}${guardedValidation}});
`;
}

/** The locale entry merged into the module's `utils/locales.json`. */
export function endpointLocaleEntries(spec: EndpointSpec): Record<string, Record<string, string>> {
  return { [successMessageKey(spec)]: { en: successMessage(spec) } };
}
