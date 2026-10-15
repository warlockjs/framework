import { afterEach, describe, expect, it } from "vitest";
import {
  clearRecordedEnvironmentOverrides,
  recordEnvironmentOverrides,
} from "../utils/recorded-environment-overrides";
import { remedyLines, shouldPreflightHttpPort } from "./boot-port-preflight";

/** The exact affirmative advice that is WRONG when HTTP_PORT is the source. */
const CONFIG_EDIT_ADVICE = "change http.port in src/config/http.ts and rebuild";

/**
 * The HTTP-port preflight must run only for a boot that will actually start
 * http, or a scoped data command (seed/migrate) probes — and collides with — a
 * port it never binds (finding f9ace89e).
 */
describe("shouldPreflightHttpPort (f9ace89e)", () => {
  it("preflights a full boot (connectors: true)", () => {
    expect(shouldPreflightHttpPort(true)).toBe(true);
  });

  it("preflights an explicit list that names http", () => {
    expect(shouldPreflightHttpPort(["http", "database"])).toBe(true);
  });

  it("does NOT preflight a scoped list without http (warlock seed)", () => {
    expect(shouldPreflightHttpPort(["database", "cache", "logger"])).toBe(false);
  });

  it("does NOT preflight an empty list", () => {
    expect(shouldPreflightHttpPort([])).toBe(false);
  });
});

/**
 * When the colliding port came from an ambient `HTTP_PORT` that beat `.env`,
 * "change http.port in src/config/http.ts and rebuild" is actively wrong — the
 * env var wins, so the rebuild changes nothing (the reporter followed it
 * twice). The remedy must name the variable and tell the reader to unset it
 * instead (finding 8782b840). Provenance is carried from the env-load detector,
 * not recomputed here.
 */
describe("remedyLines — port-collision advice follows provenance (8782b840)", () => {
  afterEach(() => {
    clearRecordedEnvironmentOverrides();
  });

  it("names HTTP_PORT and says to unset it — NOT to edit config — when an ambient HTTP_PORT is the colliding port", () => {
    recordEnvironmentOverrides([
      { key: "HTTP_PORT", effectiveValue: "41900", fileValue: "2030" },
    ]);

    const message = remedyLines(41900).join("\n");

    expect(message).toContain("HTTP_PORT");
    expect(message).toContain("unset HTTP_PORT");
    expect(message).toContain("41900"); // the ambient value in effect
    expect(message).toContain("2030"); // the .env value it overrode
    // The affirmative wrong advice must be gone (a negated mention that editing
    // config "will NOT change it" is allowed — advising the edit is not).
    expect(message).not.toContain(CONFIG_EDIT_ADVICE);
  });

  it("gives the config-edit advice when no ambient HTTP_PORT override was recorded", () => {
    const message = remedyLines(2030).join("\n");

    expect(message).toContain(CONFIG_EDIT_ADVICE);
    expect(message).not.toContain("unset HTTP_PORT");
  });

  it("does NOT blame HTTP_PORT when the override is for a DIFFERENT port than the one colliding", () => {
    // Ambient HTTP_PORT=41900 beat .env, but the collision is on 3000 (config).
    // Blaming HTTP_PORT here would send the reader to unset a variable that is
    // not the cause of THIS collision.
    recordEnvironmentOverrides([
      { key: "HTTP_PORT", effectiveValue: "41900", fileValue: "2030" },
    ]);

    const message = remedyLines(3000).join("\n");

    expect(message).toContain(CONFIG_EDIT_ADVICE);
    expect(message).not.toContain("unset HTTP_PORT");
  });
});
