import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { PostResource } from "app/posts/resources/post.resource";
import { Post } from "../models/post/post.model";
import { createPostSchema, type CreatePostSchema } from "../schema/create-post.schema";

export const createNewPostController: GuardedRequestHandler<CreatePostSchema> = async ({
  request,
  response,
}) => {
  const post = await Post.create({
    ...request.validated(),
    authorId: request.locals.user.id,
  });

  return response.successCreate({
    post,
  });
};

createNewPostController.validation = {
  schema: createPostSchema,
};

createNewPostController.responseSchema = {
  201: { body: { post: PostResource } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
