/** Validates the contact form on both the browser and the server. */
import { v } from "@warlock.js/seal";

export const contactSchema = v.object({
  name: v.string().min(2),
  email: v.email(),
  message: v.string().min(10),
});
