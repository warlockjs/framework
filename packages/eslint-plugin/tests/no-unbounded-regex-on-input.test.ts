import { describe, expect, it } from "vitest";
import {
  findUnboundedQuantifier,
  noUnboundedRegexOnInput,
} from "../src/rules/no-unbounded-regex-on-input";
import { createRuleTester } from "./rule-tester";

describe("findUnboundedQuantifier", () => {
  it.each([
    ["^\\d+$", "+"],
    ["a.*b", "*"],
    ["a.*?b", "*?"],
    ["x{2,}", "{2,}"],
  ])("finds the quantifier in %s", (source, quantifier) => {
    expect(findUnboundedQuantifier(source)).toBe(quantifier);
  });

  it.each(["^\\d{1,10}$", "[+*]", "\\+\\*", "a{2}", "a{2,5}", "abc"])("accepts %s", (source) => {
    expect(findUnboundedQuantifier(source)).toBeUndefined();
  });
});

createRuleTester().run("no-unbounded-regex-on-input", noUnboundedRegexOnInput, {
  valid: [
    "/^\\d{1,10}$/.test(request.input('code'));",
    "/^\\d+$/.test(config.port);",
    "const slug = request.string('slug'); slug.replace(/-{1,8}/g, '-');",
    "/^[a-z]+$/.test(safe.slice(0, 64));",
    "const pattern = /^[a-z0-9-]{1,64}$/; pattern.test(request.input('slug'));",
  ],
  invalid: [
    {
      code: "/^(a+)+$/.test(request.input('name'));",
      errors: [{ messageId: "unbounded", data: { quantifier: "+" } }],
    },
    {
      code: "const EMAIL = /^\\S+@\\S+$/;\nif (!EMAIL.test(request.input('email'))) throw new Error();",
      errors: [{ messageId: "unbounded" }],
    },
    {
      code: "request.string('query').match(/(\\w*)*/);",
      errors: [{ messageId: "unbounded", data: { quantifier: "*" } }],
    },
    {
      code: "const term = request.input('q');\nterm.replace(new RegExp('\\\\s{2,}', 'g'), ' ');",
      errors: [{ messageId: "unbounded", data: { quantifier: "{2,}" } }],
    },
    {
      code: "new RegExp('^.*$').exec(req.body.text);",
      errors: [{ messageId: "unbounded" }],
    },
  ],
});
