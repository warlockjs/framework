import { describe, expect, it } from "vitest";
import { contactSchema } from "../../shared/contact.schema";

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "Hello from a test.",
};

describe("contact form validation", () => {
  // @proves contact/send-message AC-1
  it("accepts a valid message", async () => {
    const result = await contactSchema.validate(valid);

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // @proves contact/send-message AC-2
  it("names each field that is wrong", async () => {
    const result = await contactSchema.validate({ ...valid, email: "not-an-email", name: "A" });
    const fields = result.errors.map((error) => error.input);

    expect(result.isValid).toBe(false);
    expect(fields).toContain("email");
    expect(fields).toContain("name");
  });
});
