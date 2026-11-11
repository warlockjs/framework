import { describe, expect, it, vi } from "vitest";

vi.mock("@warlock.js/cache", () => ({ cache: {} }));
vi.mock("@warlock.js/core", () => ({ t: (key: string) => key }));
vi.mock("@warlock.js/logger", () => ({ log: { error: vi.fn(), warn: vi.fn() } }));

import { throttleIdentifierHash } from "../middleware/login-throttle.middleware";
import {
  defaultNormalizeCredentials,
  normalizeEmailIdentifier,
  trimIdentifiers,
} from "./normalize-credentials";

describe("credential normalization", () => {
  it("trims string values and lower-cases only the email field", () => {
    expect(
      defaultNormalizeCredentials({ email: "  Sara@X.io ", username: " Sara ", age: 3 }),
    ).toEqual({ email: "sara@x.io", username: "Sara", age: 3 });
  });

  it("trimIdentifiers keeps the case as sent", () => {
    expect(trimIdentifiers({ email: " Sara@X.io " })).toEqual({ email: "Sara@X.io" });
  });

  it("the throttle key and the lookup share one normalization rule", () => {
    const sent = "  Sara@X.io ";
    const looked = defaultNormalizeCredentials({ email: sent }).email as string;

    expect(looked).toBe(normalizeEmailIdentifier(sent));
    expect(throttleIdentifierHash("email", sent)).toBe(throttleIdentifierHash("email", looked));
  });
});
