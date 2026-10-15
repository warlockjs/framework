import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import {
  arrayRule,
  booleanRule,
  floatRule,
  intRule,
  numberRule,
  objectRule,
  plainObjectRule,
  scalarRule,
  stringRule,
} from "../../../src/rules/common/type-rules";

describe("Type Rules", () => {
  it("stringRule", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(stringRule);

    expect((await validate(validator, "test")).isValid).toBe(true);
    expect((await validate(validator, 123)).isValid).toBe(false);
    expect((await validate(validator, true)).isValid).toBe(false);
    expect((await validate(validator, {})).isValid).toBe(false);
  });

  it("numberRule", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(numberRule);

    expect((await validate(validator, 123)).isValid).toBe(true);
    expect((await validate(validator, 12.34)).isValid).toBe(true);
    expect((await validate(validator, "123")).isValid).toBe(false);
    expect((await validate(validator, NaN)).isValid).toBe(true);
  });

  it("booleanRule", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(booleanRule);

    expect((await validate(validator, true)).isValid).toBe(true);
    expect((await validate(validator, false)).isValid).toBe(true);
    expect((await validate(validator, "true")).isValid).toBe(false);
    expect((await validate(validator, 0)).isValid).toBe(false);
  });

  it("intRule", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(intRule);

    expect((await validate(validator, 123)).isValid).toBe(true);
    expect((await validate(validator, 0)).isValid).toBe(true);
    expect((await validate(validator, 12.34)).isValid).toBe(false);
    expect((await validate(validator, "123")).isValid).toBe(false);
  });

  it("floatRule", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(floatRule);

    expect((await validate(validator, 12.34)).isValid).toBe(true);
    expect((await validate(validator, 123)).isValid).toBe(false);
    expect((await validate(validator, 0)).isValid).toBe(false);
    expect((await validate(validator, "12.34")).isValid).toBe(false);
  });

  it("scalarRule", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(scalarRule);

    expect((await validate(validator, "test")).isValid).toBe(true);
    expect((await validate(validator, 123)).isValid).toBe(true);
    expect((await validate(validator, true)).isValid).toBe(true);
    expect((await validate(validator, {})).isValid).toBe(false);

    expect((await validate(validator, [1])).isValid).toBe(false);

    const reqValidator = v.any().required();
    reqValidator.addMutableRule(scalarRule);
    expect((await validate(reqValidator, null)).isValid).toBe(false);
  });

  it("objectRule", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(objectRule);

    expect((await validate(validator, {})).isValid).toBe(true);
    expect((await validate(validator, { a: 1 })).isValid).toBe(true);
    // objectRule is the loose `typeof === object` check — arrays are objects too.
    // Use plainObjectRule when arrays must be rejected (see below).
    expect((await validate(validator, [1])).isValid).toBe(true);

    const reqValidator = v.any().required();
    reqValidator.addMutableRule(objectRule);
    expect((await validate(reqValidator, null)).isValid).toBe(false);
    expect((await validate(validator, "test")).isValid).toBe(false);
  });

  it("plainObjectRule rejects arrays", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(plainObjectRule);

    expect((await validate(validator, {})).isValid).toBe(true);
    expect((await validate(validator, { a: 1 })).isValid).toBe(true);
    expect((await validate(validator, [1])).isValid).toBe(false);
    expect((await validate(validator, "test")).isValid).toBe(false);
  });

  it("arrayRule", async () => {
    const validator = v.any().mutable;
    validator.addMutableRule(arrayRule);

    expect((await validate(validator, [])).isValid).toBe(true);
    expect((await validate(validator, [1, 2])).isValid).toBe(true);

    expect((await validate(validator, {})).isValid).toBe(false);
    expect((await validate(validator, "test")).isValid).toBe(false);
  });
});
