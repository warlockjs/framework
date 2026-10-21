import { describe, expect, it, vi } from "vitest";
import { defineResource } from "../resource/define-resource";
import { nullable } from "../resource/nullable-resource";
import type { RequestHandler } from "../router/types";
import { assertResponseContracts, type ResponseContractRoute } from "./response-contract";

function route(
  schema: RequestHandler["responseSchema"],
  path = "/products",
): ResponseContractRoute {
  const handler: RequestHandler = () => undefined;
  handler.responseSchema = schema;
  return { method: "GET", path, handler };
}
function client(body: unknown, status = 200) {
  return {
    request: vi.fn(
      async () => new Response(status === 204 ? null : JSON.stringify(body), { status }),
    ),
  };
}

describe("assertResponseContracts", () => {
  it("validates real JSON shapes including resources, arrays and nullability", async () => {
    const Product = defineResource({ schema: { id: "int", title: "string" } });
    await assertResponseContracts({
      routes: [
        route({
          200: { body: { products: [Product], featured: nullable(Product), tags: "string[]?" } },
        }),
      ],
      client: client({ products: [{ id: 1, title: "Pen" }], featured: null, tags: ["new"] }),
    });
  });
  it.each([{ count: "1" }, {}, { count: null }])(
    "rejects a mismatched actual body: %j",
    async (body) => {
      await expect(
        assertResponseContracts({
          routes: [route({ 200: { body: { count: "int" } } })],
          client: client(body),
        }),
      ).rejects.toThrow("does not match");
    },
  );
  it("rejects undeclared and unexpected statuses", async () => {
    const routes = [route({ 200: { body: { count: "int" } } })];
    await expect(assertResponseContracts({ routes, client: client({}, 404) })).rejects.toThrow(
      "undeclared",
    );
    await expect(
      assertResponseContracts({
        routes,
        client: client({ count: 1 }),
        cases: () => [{ status: 201 }],
      }),
    ).rejects.toThrow("expected status");
  });
  it("requires explicit concrete parameter fixtures", async () => {
    const routes = [route({ 200: { body: { count: "int" } } }, "/products/:id")];
    const http = client({ count: 1 });
    await expect(assertResponseContracts({ routes, client: http })).rejects.toThrow("fixtures");
    expect(http.request).not.toHaveBeenCalled();
    await assertResponseContracts({
      routes,
      client: http,
      cases: () => [{ path: "/products/1", status: 200 }],
    });
  });
  it("can require fixtures for every declared status", async () => {
    await expect(
      assertResponseContracts({
        routes: [route({ 200: { body: { count: "int" } }, 404: { body: { error: "string" } } })],
        client: client({ count: 1 }),
        requireAllStatuses: true,
      }),
    ).rejects.toThrow("untested declared statuses: 404");
  });
  it("checks bodyless statuses and refuses empty discovery", async () => {
    await assertResponseContracts({
      routes: [route({ 204: { body: {} } })],
      client: client(null, 204),
    });
    await expect(assertResponseContracts({ routes: [] })).rejects.toThrow("No response contracts");
  });
});
