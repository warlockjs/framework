import { describe, expect, it } from "vitest";
import { CalculatorError } from "../errors";
import { causeOf } from "../test-support";
import { calculatorTool } from "./calculator";

/**
 * Evaluate an expression through the tool's never-throwing `invoke()` and
 * return the numeric result, failing the test if the tool surfaced an
 * error instead of data.
 */
async function evaluate(expression: string): Promise<number> {
  const { data, error } = await calculatorTool().invoke({ expression });

  expect(error, `expected no error for "${expression}"`).toBeUndefined();
  expect(data).toBeDefined();

  return (data as { result: number }).result;
}

/**
 * Invoke the tool expecting a failure, returning the surfaced error so the
 * test can assert on its message / type. The underlying handler throws a
 * {@link CalculatorError}, which `tool()` re-wraps as a `ToolExecutionError`
 * whose message is preserved.
 */
async function expectError(expression: string) {
  const { data, error } = await calculatorTool().invoke({ expression });

  expect(data, `expected an error for "${expression}"`).toBeUndefined();
  expect(error).toBeDefined();

  return error;
}

describe("calculatorTool", () => {
  describe("arithmetic", () => {
    it("adds and subtracts left-to-right", async () => {
      expect(await evaluate("1 + 2 + 3")).toBe(6);
      expect(await evaluate("10 - 4 - 3")).toBe(3);
    });

    it("respects * and / precedence over + and -", async () => {
      expect(await evaluate("2 + 3 * 4")).toBe(14);
      expect(await evaluate("2 * 3 + 4")).toBe(10);
      expect(await evaluate("20 - 2 * 5")).toBe(10);
    });

    it("evaluates parentheses first", async () => {
      expect(await evaluate("(3 + 4) * 2")).toBe(14);
      expect(await evaluate("2 * (1 + (3 - 1))")).toBe(6);
    });

    it("handles the modulo operator", async () => {
      expect(await evaluate("10 % 3")).toBe(1);
      expect(await evaluate("10 % 3 + 1")).toBe(2);
    });

    it("treats ^ as right-associative exponentiation", async () => {
      expect(await evaluate("2 ^ 3")).toBe(8);
      expect(await evaluate("2 ^ 3 ^ 2")).toBe(512); // 2 ^ (3 ^ 2) = 2 ^ 9
      expect(await evaluate("(2 ^ 3) ^ 2")).toBe(64);
    });

    it("binds ^ tighter than * and -", async () => {
      expect(await evaluate("2 * 2 ^ 3")).toBe(16);
      expect(await evaluate("-2 ^ 2")).toBe(4); // unary minus folds into the literal: (-2) ^ 2
    });

    it("supports unary minus and plus", async () => {
      expect(await evaluate("-5")).toBe(-5);
      expect(await evaluate("3 + -2")).toBe(1);
      expect(await evaluate("3 - -2")).toBe(5);
      expect(await evaluate("--3")).toBe(3);
      expect(await evaluate("+7")).toBe(7);
    });

    it("applies a unary sign to a parenthesized group", async () => {
      expect(await evaluate("-(3 + 4)")).toBe(-7);
      expect(await evaluate("2 * -(1 + 1)")).toBe(-4);
    });

    it("parses decimal and scientific-notation literals", async () => {
      expect(await evaluate("1.5 + 2.25")).toBe(3.75);
      expect(await evaluate("0.1 + 0.2")).toBeCloseTo(0.3);
      expect(await evaluate("1e3")).toBe(1000);
      expect(await evaluate("2.5E-2")).toBe(0.025);
      expect(await evaluate(".5 + .5")).toBe(1);
    });

    it("ignores surrounding and interleaved whitespace", async () => {
      expect(await evaluate("  3   *   ( 2 +\t1 ) ")).toBe(9);
    });
  });

  describe("errors (surfaced as data, never thrown)", () => {
    it("rejects division by zero with a typed error", async () => {
      const error = await expectError("1 / 0");

      expect(error?.message).toMatch(/division by zero/i);
      expect((causeOf(error) as CalculatorError).type).toBe("divide-by-zero");
    });

    it("rejects modulo by zero", async () => {
      const error = await expectError("5 % 0");

      expect((causeOf(error) as CalculatorError).type).toBe("divide-by-zero");
    });

    it("rejects non-arithmetic / code-like input", async () => {
      const error = await expectError("alert(1)");

      expect(error?.message).toMatch(/unexpected character/i);
      expect((causeOf(error) as CalculatorError).type).toBe("syntax");
    });

    it("rejects identifiers and property access", async () => {
      await expectError("process.env");
      await expectError("a + b");
      await expectError("Math.max(1, 2)");
    });

    it("rejects an empty expression", async () => {
      const error = await expectError("   ");

      expect((causeOf(error) as CalculatorError).type).toBe("syntax");
    });

    it("rejects unbalanced parentheses", async () => {
      await expectError("(1 + 2");
      await expectError("1 + 2)");
      await expectError(")(");
    });

    it("rejects a trailing or doubled binary operator", async () => {
      await expectError("1 +");
      await expectError("1 * * 2");
      await expectError("* 3");
    });

    it("rejects two adjacent numbers", async () => {
      await expectError("3 4");
    });

    it("never throws from invoke(), even on garbage", async () => {
      await expect(
        calculatorTool().invoke({ expression: "@#$%^&*" }),
      ).resolves.toMatchObject({ error: expect.anything() });
    });
  });

  describe("schema", () => {
    it("rejects a non-string expression at the schema layer", async () => {
      const { error } = await calculatorTool().invoke({ expression: 42 });

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/must be a string/i);
    });

    it("honors a custom tool name", () => {
      expect(calculatorTool({ name: "calc" }).name).toBe("calc");
      expect(calculatorTool().name).toBe("calculator");
    });
  });
});
