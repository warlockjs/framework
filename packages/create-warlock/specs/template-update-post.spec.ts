import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The starter's `PUT /posts/:id` controller (`templates/warlock/src/app/posts`),
 * run against in-memory fakes: the uploaded image is stored only after the
 * author (or admin) check passes, so a refused update leaves no file behind.
 */

const state = vi.hoisted(() => ({
  post: undefined as { authorId: number; saved: unknown[] } | undefined,
}));

vi.mock("@warlock.js/core", () => {
  class ForbiddenError extends Error {
    public status = 403;
  }

  class ResourceNotFoundError extends Error {
    public status = 404;
  }

  return { ForbiddenError, ResourceNotFoundError };
});

vi.mock("@warlock.js/seal", () => ({
  v: { object: () => ({}), string: () => ({ uuid: () => ({}) }) },
}));

vi.mock("app/posts/resources/post.resource", () => ({ PostResource: {} }));

vi.mock("../templates/warlock/src/app/posts/schema/update-post.schema", () => ({
  updatePostSchema: {},
}));

vi.mock("../templates/warlock/src/app/posts/models/post/post.model", () => ({
  Post: {
    first: async () => {
      const post = state.post;

      if (!post) return null;

      return {
        get: (key: string) => (key === "authorId" ? post.authorId : undefined),
        save: async (options: unknown) => {
          post.saved.push(options);
        },
      };
    },
  },
}));

import { updatePostController } from "../templates/warlock/src/app/posts/controllers/update-post.controller";

function updateRequest(user: { id: number; role: string }) {
  const image = { save: vi.fn(async (directory: string) => ({ path: `${directory}/new.png` })) };
  const request = {
    validated: () => ({ id: "post-id", title: "New title", description: "New text", image }),
    locals: {
      user: { id: user.id, get: (key: string) => (key === "role" ? user.role : undefined) },
    },
  };
  const response = { success: (body: unknown) => body };

  return { image, run: () => updatePostController({ request, response } as never) };
}

beforeEach(() => {
  state.post = { authorId: 7, saved: [] };
});

describe("update post", () => {
  it("validates the image without storing it, so storing waits for the controller", () => {
    const schema = readFileSync(
      new URL("../templates/warlock/src/app/posts/schema/update-post.schema.ts", import.meta.url),
      "utf8",
    );

    expect(schema).toMatch(/image: v\.file\(\)/);
    expect(schema).not.toContain("saveTo(");
  });

  it("stores nothing when a user who did not write the post sends a new image", async () => {
    const { image, run } = updateRequest({ id: 9, role: "user" });

    await expect(run()).rejects.toMatchObject({ status: 403 });
    expect(image.save).not.toHaveBeenCalled();
    expect(state.post?.saved).toEqual([]);
  });

  it("stores the image and updates the post for its author", async () => {
    const { image, run } = updateRequest({ id: 7, role: "user" });

    await run();

    expect(image.save).toHaveBeenCalledTimes(1);
    expect(state.post?.saved).toEqual([
      { merge: { title: "New title", description: "New text", image: "posts/new.png" } },
    ]);
  });

  it("lets an admin update another user's post", async () => {
    const { image, run } = updateRequest({ id: 9, role: "admin" });

    await run();

    expect(image.save).toHaveBeenCalledTimes(1);
  });
});
