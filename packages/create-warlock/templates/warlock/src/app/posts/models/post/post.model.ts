import { randomUUID } from "node:crypto";
import { Model, RegisterModel } from "@warlock.js/cascade";
import { useComputedSlug } from "@warlock.js/core";
import { v, type Infer } from "@warlock.js/seal";
import { PostResource } from "app/posts/resources/post.resource";

export const postSchema = v.object({
  publicId: v
    .string()
    .uuid()
    .default(() => randomUUID()),
  authorId: v.number(),
  title: v.string(),
  description: v.string(),
  slug: v.computed(useComputedSlug()),
  image: v.string(),
});

type PostSchema = Infer<typeof postSchema>;

@RegisterModel()
export class Post extends Model<PostSchema> {
  public static table = "posts";

  public static schema = postSchema;

  public static resource = PostResource;
}
