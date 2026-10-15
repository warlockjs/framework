import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shopOpenApiDocument } from "./shop-openapi-document.fixture";
import { openApiToPostmanCollection } from "./openapi-to-postman-collection";

type SchemaValidator = ((data: unknown) => boolean) & { errors?: unknown };

type AjvInstance = {
  addMetaSchema(schema: unknown): void;
  compile(schema: unknown): SchemaValidator;
};

type AjvConstructor = new (options: Record<string, unknown>) => AjvInstance;

/**
 * The official Postman v2.1.0 schema is JSON Schema draft-04, which ajv 8 dropped. ajv 6 is
 * what eslint (a dev dependency of core) already brings, so it is resolved through eslint
 * instead of being added as a dependency of its own.
 */
function compilePostmanValidator(): SchemaValidator {
  const requireFromEslint = createRequire(createRequire(__filename).resolve("eslint/package.json"));
  const Ajv: AjvConstructor = requireFromEslint("ajv");
  const ajv = new Ajv({ schemaId: "auto", allErrors: true, unknownFormats: "ignore" });

  ajv.addMetaSchema(requireFromEslint("ajv/lib/refs/json-schema-draft-04.json"));

  // Source: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
  const schemaPath = path.resolve(__dirname, "../../../tests/fixtures/postman/collection-v2.1.0.schema.json");

  return ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
}

describe("Postman Collection v2.1.0 schema", () => {
  const validate = compilePostmanValidator();

  it("accepts the converted shop collection", () => {
    const valid = validate(JSON.parse(JSON.stringify(openApiToPostmanCollection(shopOpenApiDocument))));

    expect(validate.errors ?? null).toBeNull();
    expect(valid).toBe(true);
  });

  it("rejects a collection without info, so the check is live", () => {
    const { info: _info, ...withoutInfo } = openApiToPostmanCollection(shopOpenApiDocument);

    expect(validate(withoutInfo)).toBe(false);
  });
});
