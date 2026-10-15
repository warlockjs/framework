import { describe, expect, it } from "vitest";
import {
  getDevelopmentOpenApiDocument,
  getDevelopmentPostmanCollection,
  registerDevelopmentOpenApiProvider,
} from "./development-openapi-provider";

describe("development OpenAPI provider", () => {
  it("refuses outside warlock dev, then serves what the registered provider builds", async () => {
    await expect(getDevelopmentOpenApiDocument()).rejects.toThrow(/only available under `warlock dev`/);
    await expect(getDevelopmentPostmanCollection()).rejects.toThrow(/only available under `warlock dev`/);

    const result = { document: { openapi: "3.1.0" }, warnings: [] };
    registerDevelopmentOpenApiProvider(async () => result as never);

    await expect(getDevelopmentOpenApiDocument()).resolves.toBe(result);
  });

  it("converts the provider's document into a Postman collection and passes the warnings through", async () => {
    registerDevelopmentOpenApiProvider(
      async () =>
        ({
          document: {
            openapi: "3.1.0",
            info: { title: "Dev App", version: "1.0.0" },
            paths: { "/ping": { get: { operationId: "ping", responses: {} } } },
          },
          warnings: ["GET /x: gap"],
        }) as never,
    );

    const { collection, warnings } = await getDevelopmentPostmanCollection({ baseUrl: "http://localhost:2030" });

    expect(collection.info.name).toBe("Dev App");
    expect(collection.variable[0]).toEqual({ key: "baseUrl", value: "http://localhost:2030", type: "string" });
    expect(collection.item).toHaveLength(1);
    expect(warnings).toEqual(["GET /x: gap"]);
  });
});
