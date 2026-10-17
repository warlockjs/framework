import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CookieJarUnavailableError } from "../http/errors/errors";
import { PortInUseError } from "../http/port-preflight";
import { RouteNameTakenError } from "../router/route-name-taken-error";
import {
  ERROR_CODES,
  type ErrorCodeArea,
  errorCodeDocsUrl,
  errorCodeOf,
  explainErrorCode,
  isWarlockErrorCode,
} from "./error-codes";
import { WarlockError } from "./warlock-error";

const AREA_DIGIT: Record<ErrorCodeArea, string> = {
  config: "1",
  boot: "2",
  routing: "3",
  validation: "4",
  http: "5",
  database: "6",
  cli: "7",
  environment: "8",
  convention: "9",
};

const packageRoot = path.resolve(__dirname, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");

describe("error code registry", () => {
  it("keys every entry by its own code, in the WL + four digits scheme", () => {
    for (const [key, definition] of Object.entries(ERROR_CODES)) {
      expect(definition.code).toBe(key);
      expect(key).toMatch(/^WL\d{4}$/);
    }
  });

  it("numbers every code inside its area's range", () => {
    for (const definition of Object.values(ERROR_CODES)) {
      expect(definition.code.charAt(2), definition.code).toBe(AREA_DIGIT[definition.area]);
    }
  });

  it("files every environment-area code as an environment problem and nothing else", () => {
    for (const definition of Object.values(ERROR_CODES)) {
      expect(definition.category === "environment", definition.code).toBe(
        definition.area === "environment",
      );
    }
  });

  it("gives every code a one-line title and fix", () => {
    for (const definition of Object.values(ERROR_CODES)) {
      expect(definition.title.length, definition.code).toBeGreaterThan(0);
      expect(definition.fix.length, definition.code).toBeGreaterThan(0);
      expect(definition.title).not.toContain("\n");
      expect(definition.fix).not.toContain("\n");
    }
  });

  it("points every code at a skill that exists in core", () => {
    const skills = new Set(readdirSync(path.join(packageRoot, "skills")));

    for (const definition of Object.values(ERROR_CODES)) {
      expect(skills.has(definition.skill), `${definition.code} -> ${definition.skill}`).toBe(true);
    }
  });

  it("documents every code as a heading of the error-codes docs page", () => {
    const page = readFileSync(
      path.join(repositoryRoot, "docs/src/content/docs/v/latest/core/cli/error-codes.md"),
      "utf8",
    );

    for (const code of Object.keys(ERROR_CODES)) {
      expect(page, code).toMatch(new RegExp(`^### ${code}$`, "m"));
    }
  });

  it("explains a code whatever its case or padding, and nothing for an unknown one", () => {
    expect(explainErrorCode(" wl3001 ")?.title).toBe("A route name is already taken");
    expect(explainErrorCode("WL0000")).toBeUndefined();
    expect(isWarlockErrorCode("WL3001")).toBe(true);
    expect(isWarlockErrorCode("EADDRINUSE")).toBe(false);
    expect(errorCodeDocsUrl("WL3001")).toBe(
      "https://warlock.js.org/v/latest/core/cli/error-codes/#wl3001",
    );
  });
});

describe("errorCodeOf", () => {
  it("reads the code framework errors carry", () => {
    expect(errorCodeOf(new WarlockError("WL3003", "x"))).toBe("WL3003");
    expect(errorCodeOf(new RouteNameTakenError("home", "taken"))).toBe("WL3001");
    expect(errorCodeOf(new CookieJarUnavailableError("session"))).toBe("WL5001");
  });

  it("maps an error whose code property means something else by its name", () => {
    const error = new PortInUseError(3000, "localhost");

    expect(error.code).toBe("EADDRINUSE");
    expect(errorCodeOf(error)).toBe("WL8004");
  });

  it("maps Node system errors to the environment codes", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), {
      code: "ECONNREFUSED",
    });

    expect(errorCodeOf(refused)).toBe("WL8003");
  });

  it("follows the cause chain, and returns undefined for plain values", () => {
    const wrapped = new Error("boot failed", { cause: new WarlockError("WL2003", "inner") });

    expect(errorCodeOf(wrapped)).toBe("WL2003");
    expect(errorCodeOf(new Error("plain"))).toBeUndefined();
    expect(errorCodeOf("WL3001")).toBeUndefined();
    expect(errorCodeOf(null)).toBeUndefined();
  });
});
