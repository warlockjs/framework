import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Pure, dependency-free re-implementation of Node's `net.isIP`/`isIPv4`/`isIPv6`.
 * Mirrors the exact regex Node uses internally (lib/internal/net.js) so that
 * behavior stays identical while remaining runnable in the browser (no `net` import).
 */
const v4Seg = "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
const v4Str = `(${v4Seg}[.]){3}${v4Seg}`;
const IPv4Reg = new RegExp(`^${v4Str}$`);

const v6Seg = "(?:[0-9a-fA-F]{1,4})";
const IPv6Reg = new RegExp(
  "^(" +
    `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` +
    `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` +
    `(?:${v6Seg}:){5}(?::${v4Str}|(:${v6Seg}){1,2}|:)|` +
    `(?:${v6Seg}:){4}(?:(:${v6Seg}){0,1}:${v4Str}|(:${v6Seg}){1,3}|:)|` +
    `(?:${v6Seg}:){3}(?:(:${v6Seg}){0,2}:${v4Str}|(:${v6Seg}){1,4}|:)|` +
    `(?:${v6Seg}:){2}(?:(:${v6Seg}){0,3}:${v4Str}|(:${v6Seg}){1,5}|:)|` +
    `(?:${v6Seg}:){1}(?:(:${v6Seg}){0,4}:${v4Str}|(:${v6Seg}){1,6}|:)|` +
    `(?::((?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` +
    ")(%[0-9a-zA-Z-.:]{1,})?$",
);

export function isIPv4(value: string): boolean {
  return IPv4Reg.test(value);
}

export function isIPv6(value: string): boolean {
  return IPv6Reg.test(value);
}

/**
 * Returns 4 or 6 when `value` is a valid IPv4/IPv6 address, otherwise 0.
 * Signature mirrors Node's `net.isIP` for drop-in behavior parity.
 */
export function isIP(value: string): 0 | 4 | 6 {
  if (isIPv4(value)) return 4;
  if (isIPv6(value)) return 6;
  return 0;
}

/**
 * IP rule - validates IP address (v4 or v6)
 */
export const ipRule: SchemaRule = {
  name: "ip",
  defaultErrorMessage: "The :input must be a valid IP address",
  async validate(value: any, context) {
    if (isIP(value)) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * IPv4 rule - validates IPv4 address
 */
export const ip4Rule: SchemaRule = {
  name: "ip4",
  defaultErrorMessage: "The :input must be a valid IPv4 address",
  async validate(value: any, context) {
    if (isIP(value) === 4) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * IPv6 rule - validates IPv6 address
 */
export const ip6Rule: SchemaRule = {
  name: "ip6",
  defaultErrorMessage: "The :input must be a valid IPv6 address",
  async validate(value: any, context) {
    if (isIP(value) === 6) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};
