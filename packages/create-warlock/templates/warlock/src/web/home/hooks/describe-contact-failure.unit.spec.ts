import { describe, expect, it } from "vitest";
import { describeContactFailure } from "./describe-contact-failure";

describe("describeContactFailure", () => {
  // @proves contact/send-message AC-3
  it("tells the visitor to check the connection when the server cannot be reached", () => {
    expect(describeContactFailure({})).toMatch(/check your connection/i);
  });

  // @proves contact/send-message AC-4
  it("tells the visitor to try again when the server fails without saying why", () => {
    expect(describeContactFailure({ status: 500 })).toMatch(/try again/i);
  });

  // @proves design-system/error-messages AC-1
  it("says what failed and what to do next, and keeps the server's own words", () => {
    const unreachable = describeContactFailure({});
    const failed = describeContactFailure({ status: 500 });
    const rejected = describeContactFailure({ status: 400, message: "The email is not valid." });

    expect(unreachable).toMatch(/could not reach/i);
    expect(failed).toMatch(/could not send/i);
    expect(rejected).toBe("The email is not valid.");
  });
});
