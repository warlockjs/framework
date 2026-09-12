import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { jwtSecretCheck } from "./jwt-secret.check";

/**
 * `jwt-secret` fails when auth is configured but no signing secret is set —
 * the pre-flight version of the first-login 500 the lazy secret resolution
 * throws (finding 7b606e38). It stays silent for a project not doing auth.
 */
const bootContext = {} as DoctorBootContext;

// `DoctorCheck.run` is typed sync-or-async (`CheckResult | Promise<…>`), so
// awaiting normalises both to `CheckResult | undefined` — reading `.status` off
// the raw union does not typecheck (the Promise branch has no `.status`).
async function run() {
  return await jwtSecretCheck.run(bootContext);
}

afterEach(() => {
  // baseConfig is a singleton; reset the auth group between cases.
  setConfig("auth", undefined as unknown as never);
});

describe("doctor jwt-secret check (7b606e38)", () => {
  it("FAILS when auth is configured (userType) but no secret is set", async () => {
    setConfig("auth", { userType: { user: class {} } } as never);

    const result = await run();

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("warlock jwt.generate");
  });

  it("is OK when the legacy auth.jwt.secret is set", async () => {
    setConfig("auth", { userType: { user: class {} }, jwt: { secret: "s3cret" } } as never);

    expect((await run())?.status).toBe("ok");
  });

  it("is OK when the current auth.accessToken.secret is set", async () => {
    setConfig("auth", { userType: { user: class {} }, accessToken: { secret: "s3cret" } } as never);

    expect((await run())?.status).toBe("ok");
  });

  it("opts out (undefined) when auth is not in use", async () => {
    setConfig("auth", { userType: {} } as never);

    expect(await run()).toBeUndefined();
  });

  it("treats a blank secret as missing", async () => {
    setConfig("auth", { userType: { user: class {} }, jwt: { secret: "  " } } as never);

    expect((await run())?.status).toBe("fail");
  });
});
