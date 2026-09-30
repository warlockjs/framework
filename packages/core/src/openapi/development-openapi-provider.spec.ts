import { describe, expect, it } from "vitest";
import {
  getDevelopmentOpenApiDocument,
  registerDevelopmentOpenApiProvider,
} from "./development-openapi-provider";

describe("development OpenAPI provider", () => {
  it("refuses outside warlock dev, then serves what the registered provider builds", async () => {
    await expect(getDevelopmentOpenApiDocument()).rejects.toThrow(/only available under `warlock dev`/);

    const result = { document: { openapi: "3.1.0" }, warnings: [] };
    registerDevelopmentOpenApiProvider(async () => result as never);

    await expect(getDevelopmentOpenApiDocument()).resolves.toBe(result);
  });
});
