import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shopOpenApiDocument } from "./shop-openapi-document.fixture";
import { openApiToPostmanCollection } from "./openapi-to-postman-collection";

type SchemaValidator = ((data: unknown) => boolean) & { errors?: unknown };

/** Postman's draft-04 schema needs the Ajv draft-04 adapter. */
function compilePostmanValidator(): SchemaValidator {
  const Ajv = createRequire(import.meta.url)(
    "ajv-draft-04",
  ) as typeof import("ajv-draft-04").default;
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });

  // Source: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
  const schemaPath = path.resolve(
    __dirname,
    "../../../tests/fixtures/postman/collection-v2.1.0.schema.json",
  );

  return ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
}

describe("Postman Collection v2.1.0 schema", () => {
  const validate = compilePostmanValidator();

  it("accepts the converted shop collection", () => {
    const valid = validate(
      JSON.parse(JSON.stringify(openApiToPostmanCollection(shopOpenApiDocument))),
    );

    expect(validate.errors ?? null).toBeNull();
    expect(valid).toBe(true);
  });

  it("rejects a collection without info, so the check is live", () => {
    const { info: _info, ...withoutInfo } = openApiToPostmanCollection(shopOpenApiDocument);

    expect(validate(withoutInfo)).toBe(false);
  });
});
