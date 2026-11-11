import { v, type Infer } from "@warlock.js/seal";

export const updatePostSchema = v.object({
  id: v.string().uuid(),
  title: v.string(),
  description: v.string(),
  // Validated here, stored by the controller only after the author check, so a
  // refused update leaves no file behind.
  image: v.file().image().maxSize({ size: 2, unit: "MB" }),
});

export type UpdatePostSchema = Infer<typeof updatePostSchema>;
