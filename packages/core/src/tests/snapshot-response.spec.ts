import { describe, expect, it } from "vitest";
import { REDACTED, snapshotResponse } from "./snapshot-response";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("snapshotResponse", () => {
  it("keeps status, content type and body, redacting the paths that change every run", async () => {
    const snapshot = await snapshotResponse(
      json(
        {
          post: { id: 91, title: "Hello", createdAt: "2026-10-17T10:00:00Z" },
          posts: [
            { id: 1, title: "a" },
            { id: 2, title: "b" },
          ],
          token: "abc",
        },
        201,
      ),
      { redact: ["post.id", "post.createdAt", "posts.*.id", "token"] },
    );

    expect(snapshot).toEqual({
      status: 201,
      contentType: "application/json",
      body: {
        post: { id: REDACTED, title: "Hello", createdAt: REDACTED },
        posts: [
          { id: REDACTED, title: "a" },
          { id: REDACTED, title: "b" },
        ],
        token: REDACTED,
      },
    });
  });

  it("keeps a non-JSON body as text and ignores paths that do not exist", async () => {
    const snapshot = await snapshotResponse(
      new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }),
      { redact: ["missing.path"] },
    );

    expect(snapshot).toEqual({ status: 200, contentType: "text/html", body: "<p>ok</p>" });
  });
});
