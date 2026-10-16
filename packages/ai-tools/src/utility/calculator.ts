import { tool, type ToolContract } from "@warlock.js/ai";
import { CalculatorError } from "../errors";
import { objectSchema, stringField } from "./schema";
import type {
  CalculatorInput,
  CalculatorOptions,
  CalculatorResult,
} from "../contracts/utility.type";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "calculator";

/** Input schema for the `calculator` tool: a single `expression` string. */
const inputSchema = objectSchema<CalculatorInput>({
  expression: stringField(),
});

/**
 * A binary operator the evaluator understands, with its precedence and
 * associativity. Higher `precedence` binds tighter; `^` is the only
 * right-associative operator (so `2 ^ 3 ^ 2` is `2 ^ (3 ^ 2)`).
 */
interface OperatorSpec {
  precedence: number;
  associativity: "left" | "right";
  /** Apply the operator to its two operands. May throw {@link CalculatorError}. */
  apply(left: number, right: number): number;
}

/** The closed set of supported binary operators. */
const OPERATORS: Record<string, OperatorSpec> = {
  "+": { precedence: 1, associativity: "left", apply: (a, b) => a + b },
  "-": { precedence: 1, associativity: "left", apply: (a, b) => a - b },
  "*": { precedence: 2, associativity: "left", apply: (a, b) => a * b },
  "/": {
    precedence: 2,
    associativity: "left",
    apply: (a, b) => {
      if (b === 0) {
        throw new CalculatorError("Division by zero.", { type: "divide-by-zero" });
      }

      return a / b;
    },
  },
  "%": {
    precedence: 2,
    associativity: "left",
    apply: (a, b) => {
      if (b === 0) {
        throw new CalculatorError("Modulo by zero.", { type: "divide-by-zero" });
      }

      return a % b;
    },
  },
  "^": { precedence: 3, associativity: "right", apply: (a, b) => a ** b },
};

/** A lexed token: a number literal, an operator, or a parenthesis. */
type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: string }
  | { type: "paren"; value: "(" | ")" };

/**
 * Tokenize an arithmetic expression into {@link Token}s. Recognizes
 * decimal and scientific-notation numbers (`3`, `4.5`, `1e3`, `2.5E-2`),
 * the operators in {@link OPERATORS}, and parentheses; whitespace is
 * skipped. Any other character is a syntax error — there is no path to
 * an identifier, function call, or property access, so nothing
 * code-like can be smuggled in.
 *
 * @throws CalculatorError `type: "syntax"` on an unrecognized character
 *   or a malformed number.
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;

      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;

      continue;
    }

    if (char in OPERATORS) {
      tokens.push({ type: "operator", value: char });
      index += 1;

      continue;
    }

    if (isDigit(char) || char === ".") {
      const { value, nextIndex } = readNumber(expression, index);
      tokens.push({ type: "number", value });
      index = nextIndex;

      continue;
    }

    throw new CalculatorError(
      `Unexpected character "${char}" at position ${index}. Only numbers, parentheses, and the operators + - * / % ^ are allowed.`,
      { type: "syntax" },
    );
  }

  return tokens;
}

/** True for an ASCII digit `0`–`9`. */
function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

/**
 * Read a single number literal starting at `start`. Consumes an optional
 * integer part, optional fraction, and optional exponent
 * (`e`/`E` with an optional sign). Returns the parsed value and the index
 * just past the literal.
 *
 * @throws CalculatorError `type: "syntax"` if the consumed run is not a
 *   valid finite number (e.g. a lone `.` or `1e` with no exponent).
 */
function readNumber(expression: string, start: number): { value: number; nextIndex: number } {
  let index = start;

  while (index < expression.length && isDigit(expression[index])) {
    index += 1;
  }

  if (expression[index] === ".") {
    index += 1;

    while (index < expression.length && isDigit(expression[index])) {
      index += 1;
    }
  }

  if (expression[index] === "e" || expression[index] === "E") {
    index += 1;

    if (expression[index] === "+" || expression[index] === "-") {
      index += 1;
    }

    while (index < expression.length && isDigit(expression[index])) {
      index += 1;
    }
  }

  const literal = expression.slice(start, index);
  const value = Number(literal);

  if (!Number.isFinite(value)) {
    throw new CalculatorError(`Invalid number literal "${literal}".`, {
      type: "syntax",
    });
  }

  return { value, nextIndex: index };
}

/**
 * Evaluate a token stream with a single left-to-right pass that resolves
 * unary signs, then a shunting-yard conversion that interleaves operator
 * application — so the result is produced without ever building an AST or
 * calling `eval`/`Function`.
 *
 * Unary `+`/`-` are detected positionally: a `+`/`-` is unary when it
 * starts the expression or directly follows another operator or an
 * opening paren. A unary `-` folds into the following number literal
 * (and a unary `+` is a no-op), which keeps the operator stack purely
 * binary.
 *
 * @throws CalculatorError on malformed structure (`type: "syntax"`),
 *   division/modulo by zero (`type: "divide-by-zero"`), or a non-finite
 *   result (`type: "overflow"`).
 */
function evaluate(tokens: Token[]): number {
  const values: number[] = [];
  const operators: string[] = [];

  /** Pop the top operator and apply it to the top two values. */
  const applyTop = (): void => {
    const operator = operators.pop();

    if (operator === undefined) {
      throw new CalculatorError("Malformed expression.", { type: "syntax" });
    }

    const right = values.pop();
    const left = values.pop();

    if (left === undefined || right === undefined) {
      throw new CalculatorError(`Operator "${operator}" is missing an operand.`, {
        type: "syntax",
      });
    }

    values.push(OPERATORS[operator].apply(left, right));
  };

  // `expectOperand` tracks the positional state machine: at the start, and
  // immediately after an operator or "(", we expect an operand (a number,
  // a "(", or a unary sign). After a number or ")", we expect a binary
  // operator or ")".
  let expectOperand = true;
  // Pending unary sign multiplier folded into the next numeric operand.
  let pendingSign = 1;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.type === "number") {
      if (!expectOperand) {
        throw new CalculatorError(
          "Unexpected number — a number cannot directly follow another value.",
          { type: "syntax" },
        );
      }

      values.push(pendingSign * token.value);
      pendingSign = 1;
      expectOperand = false;

      continue;
    }

    if (token.type === "paren") {
      if (token.value === "(") {
        if (!expectOperand) {
          throw new CalculatorError('Unexpected "(" — it cannot directly follow a value.', {
            type: "syntax",
          });
        }

        // A unary sign in front of a parenthesized group is modeled by
        // pushing the sign as a multiplication: `-(…)` becomes `-1 * (…)`.
        if (pendingSign === -1) {
          values.push(-1);
          operators.push("*");
          pendingSign = 1;
        }

        operators.push("(");
        expectOperand = true;

        continue;
      }

      // token.value === ")"
      if (expectOperand) {
        throw new CalculatorError('Unexpected ")" — an operand was expected.', { type: "syntax" });
      }

      let foundOpen = false;

      while (operators.length > 0) {
        if (operators[operators.length - 1] === "(") {
          operators.pop();
          foundOpen = true;

          break;
        }

        applyTop();
      }

      if (!foundOpen) {
        throw new CalculatorError("Unbalanced parentheses.", { type: "syntax" });
      }

      expectOperand = false;

      continue;
    }

    // token.type === "operator"
    if (expectOperand) {
      // A `+`/`-` in operand position is a unary sign; anything else is a
      // misplaced binary operator.
      if (token.value === "-") {
        pendingSign = -pendingSign;

        continue;
      }

      if (token.value === "+") {
        continue;
      }

      throw new CalculatorError(`Operator "${token.value}" has no left-hand operand.`, {
        type: "syntax",
      });
    }

    const incoming = OPERATORS[token.value];

    while (operators.length > 0) {
      const top = operators[operators.length - 1];

      if (top === "(") {
        break;
      }

      const topSpec = OPERATORS[top];
      const higher = topSpec.precedence > incoming.precedence;
      const equalLeft =
        topSpec.precedence === incoming.precedence && incoming.associativity === "left";

      if (higher || equalLeft) {
        applyTop();

        continue;
      }

      break;
    }

    operators.push(token.value);
    expectOperand = true;
  }

  if (expectOperand) {
    throw new CalculatorError("Expression ends with an operator or is empty.", { type: "syntax" });
  }

  while (operators.length > 0) {
    if (operators[operators.length - 1] === "(") {
      throw new CalculatorError("Unbalanced parentheses.", { type: "syntax" });
    }

    applyTop();
  }

  const result = values.pop();

  if (result === undefined || values.length > 0) {
    throw new CalculatorError("Malformed expression.", { type: "syntax" });
  }

  if (!Number.isFinite(result)) {
    throw new CalculatorError("Result is not a finite number.", {
      type: "overflow",
    });
  }

  return result;
}

/**
 * Build the `calculator` tool — a SAFE arithmetic evaluator the agent can
 * call to compute a numeric expression. It supports `+ - * / % ^`, unary
 * signs, parentheses, and decimal/scientific-notation literals, with the
 * usual precedence (`^` highest and right-associative, then `* / %`, then
 * `+ -`).
 *
 * **Safety.** The expression is tokenized and evaluated with a
 * shunting-yard pass — it NEVER calls `eval` or `new Function`. The
 * lexer only recognizes numbers, parentheses, and the fixed operator set,
 * so there is no path to an identifier, function call, or property
 * access; any other character is a syntax error returned as data.
 *
 * **Errors flow as data.** A malformed expression, division/modulo by
 * zero, or a non-finite result throws a {@link CalculatorError} inside
 * the handler; `tool()` catches it and surfaces it in the returned
 * `{ error }` field (the LLM-visible message is preserved), so the agent
 * reads the failure and self-corrects instead of crashing.
 *
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 * @returns A `ToolContract<{ expression }, { result }>` ready to drop into `tools: []`.
 *
 * @example
 * const calc = calculatorTool();
 * const { data } = await calc.invoke({ expression: "(3 + 4) * 2" });
 * console.log(data?.result); // 14
 */
export function calculatorTool(
  options?: CalculatorOptions,
): ToolContract<CalculatorInput, CalculatorResult> {
  return tool<CalculatorInput, CalculatorResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Evaluate an arithmetic expression and return the numeric result. " +
      "Supports + - * / % ^, parentheses, unary +/-, and decimal or " +
      "scientific-notation numbers. Does not support variables or " +
      'functions — pass a literal expression like "(3 + 4) * 2".',
    input: inputSchema,
    async execute(input) {
      const tokens = tokenize(input.expression);

      if (tokens.length === 0) {
        throw new CalculatorError("Expression is empty.", { type: "syntax" });
      }

      return { result: evaluate(tokens) };
    },
  });
}
