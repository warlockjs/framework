import { describe, expect, it } from "vitest";
import { defaultDevtoolsCrypto, loadDevtoolsPasskeys } from "../../../src/production/auth";

describe("default crypto", () => {
  it("wires core's TOTP helpers", async () => {
    const crypto = await defaultDevtoolsCrypto();
    const secret = crypto.generateTotpSecret();

    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(crypto.totpUri({ secret, account: "a@b.co", issuer: "Warlock monitor" })).toContain(
      "otpauth://totp/Warlock%20monitor:a%40b.co",
    );
    expect(crypto.verifyTotp(secret, "000000", 0)).toBeNull();
  });
});

describe("passkeys adapter", () => {
  it("loads when @simplewebauthn/server is installed and builds options with a challenge", async () => {
    const passkeys = await loadDevtoolsPasskeys();

    expect(passkeys).not.toBeNull();

    const account = {
      id: "acc-1",
      email: "boss@example.com",
      passkeys: [],
    } as never;
    const registration = await passkeys!.registrationOptions({ account, rpId: "example.com", rpName: "Warlock monitor" });

    expect(registration.challenge).toMatch(/^[\w-]{20,}$/);
    expect(registration.options).toMatchObject({ rp: { id: "example.com" }, authenticatorSelection: { userVerification: "required" } });

    const authentication = await passkeys!.authenticationOptions({ account, rpId: "example.com" });

    expect(authentication.options).toMatchObject({ rpId: "example.com", userVerification: "required" });
  });

  it("rejects an assertion for a credential the account does not have", async () => {
    const passkeys = await loadDevtoolsPasskeys();

    await expect(
      passkeys!.verifyAuthentication({
        response: { id: "unknown" },
        challenge: "c",
        origin: "https://example.com",
        rpId: "example.com",
        account: { passkeys: [] } as never,
      }),
    ).rejects.toThrow();
  });
});
