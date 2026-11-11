import { ForbiddenError, ResourceNotFoundError } from "@warlock.js/core";
import { v } from "@warlock.js/seal";
import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { PostResource } from "app/posts/resources/post.resource";
import { Post } from "../models/post/post.model";
import { updatePostSchema, type UpdatePostSchema } from "../schema/update-post.schema";

export const updatePostController: GuardedRequestHandler<UpdatePostSchema> = async ({
  request,
  response,
}) => {
  const { id, image, ...input } = request.validated();
  const post = await Post.first({ publicId: id });

  if (!post) {
    throw new ResourceNotFoundError("Post not found.");
  }

  // Only the author (or an admin) may change a post.
  const user = request.locals.user;

  if (String(post.get("authorId")) !== String(user.id) && user.get("role") !== "admin") {
    throw new ForbiddenError("You can only edit your own posts.");
  }

  // Store the new image only now that the user may change this post.
  const storedImage = await image.save("posts");

  await post.save({ merge: { ...input, image: storedImage.path } });

  return response.success({
    post,
  });
};

updatePostController.validation = {
  schema: updatePostSchema,
  params: v.object({ id: v.string().uuid() }),
};

updatePostController.responseSchema = {
  200: { body: { post: PostResource } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  403: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  404: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
