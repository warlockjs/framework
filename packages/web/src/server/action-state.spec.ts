import { describe, expect, it } from "vitest";
import { toActionState, normalizeInputName } from "./action-state";
import { createActionResponse, createLevelBuffer } from "./settle-page-response";

describe("toActionState()", () => {
  it("maps Seal errors to a dotted first-message map with 422", () => {
    const state = toActionState(
      {
        kind: "errors",
        errors: [
          { type: "required", input: "email", error: "Email is required" },
          { type: "email", input: "email", error: "Invalid email" },
          { type: "required", input: "address.city", error: "City is required" },
        ] as never,
      },
      { action: "default" },
    );

    expect(state).toMatchObject({
      action: "default",
      status: 422,
      ok: false,
      errors: { email: "Email is required", "address.city": "City is required" },
      formErrors: [],
    });
  });

  it("sends unclaimed inputs and input-less errors to formErrors", () => {
    const state = toActionState(
      {
        kind: "errors",
        errors: [
          { input: "email", error: "bad email" },
          { input: "extra", error: "extra bad" },
          { error: "general" },
        ],
      },
      { action: "default", claimedInputs: ["email"] },
    );

    expect(state.formErrors).toEqual(["extra bad", "general"]);
  });

  it("folds a failure helper's message and errors", () => {
    const response = createActionResponse(createLevelBuffer());
    const signal = response.conflict({ message: "Taken", errors: { "address[city]": "Nope" } });
    const state = toActionState({ kind: "signal", signal }, { action: "save" });

    expect(state.status).toBe(409);
    expect(state.ok).toBe(false);
    expect(state.formErrors).toEqual(["Taken"]);
    expect(state.errors).toEqual({ "address.city": "Nope" });
  });

  it("echoes values on failure, omitting redacted names, files and non-strings", () => {
    const state = toActionState(
      { kind: "errors", errors: [{ input: "email", error: "bad" }] },
      {
        action: "default",
        values: {
          email: "a@b.c",
          password: "hunter2",
          api_token: "t",
          clientSecret: "s",
          tags: ["a", "b"],
          avatar: { file: {}, fieldname: "avatar" },
        },
      },
    );

    expect(state.values).toEqual({ email: "a@b.c", tags: ["a", "b"] });
  });

  it("never echoes common secret field names", () => {
    const secrets = {
      current_password: "a",
      new_password: "b",
      newPassword: "c",
      passwordConfirmation: "d",
      password_confirmation: "e",
      passwd: "f",
      passcode: "g",
      pin: "1234",
      PIN: "1234",
      otp: "000000",
      otp_code: "000000",
      cvv: "123",
      CVC: "123",
      card_number: "4111",
      cardNumber: "4111",
      credit_card_number: "4111",
      refreshToken: "t",
      client_secret: "s",
    };
    const state = toActionState(
      { kind: "errors", errors: [] },
      { action: "default", values: { ...secrets, email: "a@b.c", pinned: "yes" } },
    );

    expect(state.values).toEqual({ email: "a@b.c", pinned: "yes" });
  });

  it("adds a configured redactValues list to the defaults instead of replacing them", () => {
    const state = toActionState(
      { kind: "errors", errors: [] },
      {
        action: "default",
        redactValues: ["ssn"],
        values: { ssn: "1", password: "p", name: "Ada" },
      },
    );

    expect(state.values).toEqual({ name: "Ada" });
  });

  it("echoes nothing when echoValues is false", () => {
    const state = toActionState(
      { kind: "errors", errors: [{ input: "email", error: "bad" }] },
      { action: "default", echoValues: false, values: { email: "a@b.c" } },
    );

    expect(state.values).toBeUndefined();
    expect(state.errors).toEqual({ email: "bad" });
  });

  it("reports success with data and no values", () => {
    const state = toActionState(
      { kind: "success", data: { saved: true } },
      { action: "save", values: { email: "x" } },
    );

    expect(state).toEqual({
      action: "save",
      status: 200,
      ok: true,
      data: { saved: true },
      errors: {},
      formErrors: [],
    });
  });
});

describe("normalizeInputName()", () => {
  it("turns bracket names into dotted ones", () => {
    expect(normalizeInputName("address[city]")).toBe("address.city");
    expect(normalizeInputName("items[0][name]")).toBe("items.0.name");
  });
});
