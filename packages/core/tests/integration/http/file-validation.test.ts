import { v } from "@warlock.js/seal";
import { afterEach, describe, expect, it } from "vitest";
import type { RequestHandler } from "../../../src/router/types";
// Importing the validation init registers the file plugin so `v.file()` exists.
import "../../../src/validation/init";
import { bootHarness, type HttpHarness } from "./harness";

/**
 * Card: a built-in optional-file validator rule so apps stop hand-rolling the
 * multipart guard. Exercises `v.file().optional()` through the REAL HTTP
 * request → validation middleware → controller path (same harness as
 * response-and-errors.test.ts), not just the bare seal validator call.
 *
 * A genuine multipart upload isn't sent here (the harness drives JSON
 * payloads); this still proves the framework's validation pipeline — the
 * part apps actually hit via `controller.validation = { schema }` — skips an
 * absent optional file and turns a present-but-wrong-shaped value into the
 * framework's structured 4xx error envelope, with no throw either way.
 */

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

function makeHandler(): RequestHandler {
  const handler: RequestHandler = ({ request, response }) => {
    return response.successCreate({ data: request.validated() });
  };

  handler.validation = {
    schema: v.object({
      name: v.string().required(),
      avatar: v.file().optional(),
    }),
  };

  return handler;
}

describe("HTTP validation — v.file().optional()", () => {
  it("passes when the optional file key is absent", async () => {
    harness = await bootHarness((router) => {
      router.post("/upload-optional", makeHandler());
    });

    const result = await harness.inject({
      method: "POST",
      url: "/upload-optional",
      payload: { name: "Sam" },
    });

    expect(result.statusCode).toBe(201);
    expect(harness.json(result)).toEqual({ data: { name: "Sam" } });
  });

  it("returns a structured 4xx error when a present avatar value is not a file", async () => {
    harness = await bootHarness((router) => {
      router.post("/upload-optional-bad", makeHandler());
    });

    const result = await harness.inject({
      method: "POST",
      url: "/upload-optional-bad",
      payload: { name: "Sam", avatar: "not-a-file" },
    });

    expect(result.statusCode).toBeGreaterThanOrEqual(400);
    expect(result.statusCode).toBeLessThan(500);

    const body = harness.json(result);

    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.some((error: { input: string }) => error.input === "avatar")).toBe(true);
  });
});
