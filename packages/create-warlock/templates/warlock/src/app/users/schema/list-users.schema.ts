import { v, type Infer } from "@warlock.js/seal";

/**
 * Query parameters the user list accepts. Unknown keys are stripped, so a
 * smuggled operator (`?email[$ne]=`) never reaches the repository filters.
 */
export const listUsersSchema = v.object({
  id: v.string().uuid().optional(),
  name: v.string().max(100).optional(),
  email: v.string().max(255).optional(),
  page: v.numeric().min(1).optional(),
  limit: v.numeric().min(1).max(100).optional(),
});

export type ListUsersSchema = Infer<typeof listUsersSchema>;
