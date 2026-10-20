import { ResourceNotFoundError } from "@warlock.js/core";
import { v } from "@warlock.js/seal";
import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { PostResource } from "app/posts/resources/post.resource";
import { Post } from "../models/post/post.model";
import { updatePostSchema, type UpdatePostSchema } from "../schema/update-post.schema";

export const updatePostController: GuardedRequestHandler<UpdatePostSchema> = async ({
  request,
  response,
}) => {
  const { id, ...input } = request.validated();
  const post = await Post.findOne({ publicId: id });

  if (!post) {
    throw new ResourceNotFoundError("Post not found.");
  }

  await post.save({ merge: input });

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
};
