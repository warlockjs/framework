/**
 * A regular-expression matcher for `grep` patterns that cannot backtrack.
 *
 * Patterns come from the model and are matched against workspace files,
 * so neither side can be trusted. The built-in engine backtracks: a pattern
 * such as `((a)+)+$` or `\d*\d*\d*x` needs exponential or high-degree
 * polynomial time on a short line, and a running `RegExp#test` cannot be
 * interrupted. This matcher compiles the same JavaScript syntax to a
 * state machine and walks every state in step (a Thompson simulation), so
 * one line costs at most `states × characters` steps whatever the pattern.
 *
 * Supported: literals and escapes, `.`, classes (`[...]`, `\d \w \s` and
 * their negations), anchors `^ $`, word boundaries `\b \B`, groups
 * (capturing, `(?:...)`, named), alternation and every quantifier (lazy
 * ones too — only whether a line matches is computed). Lookarounds and
 * backreferences need backtracking and are refused with a clear message.
 * The pattern is first compiled by the built-in engine (compiling never
 * runs it), so syntax errors read exactly as they always have.
 */

/** Why a pattern cannot be compiled by the linear matcher. */
export class UnsupportedPatternError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnsupportedPatternError";
  }
}

/** A compiled pattern. */
export interface LinearRegex {
  /** Whether `text` contains a match (the `RegExp#test` question). */
  test(text: string): boolean;
  /** Total states visited by every `test` call so far — the work done. */
  readonly steps: number;
  /** Number of states in the compiled program. */
  readonly size: number;
}

/** Options for {@link compileLinearRegex}. */
export interface LinearRegexOptions {
  /** Match case-insensitively (the `i` flag). */
  ignoreCase?: boolean;
  /** Most states the compiled program may have. Default `4000`. */
  maxStates?: number;
}

/** Default most states one program may have (bounded repeats expand). */
const DEFAULT_MAX_STATES = 4000;

/** A single-character test. */
type CharTest = (code: number) => boolean;

type Assertion = "start" | "end" | "boundary" | "non-boundary";

type Node =
  | { type: "char"; test: CharTest; literal?: number }
  | { type: "seq"; items: Node[] }
  | { type: "alt"; options: Node[] }
  | { type: "repeat"; node: Node; min: number; max: number }
  | { type: "assert"; assertion: Assertion };

const EMPTY: Node = { type: "seq", items: [] };

// ============================================================
// Character helpers
// ============================================================

/** `\w` without the `u` flag: `[A-Za-z0-9_]`. */
function isWordCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

/** `\d`: `[0-9]`. */
function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** `\s`: white space and line terminators. */
function isSpaceCode(code: number): boolean {
  return (
    (code >= 9 && code <= 13) ||
    code === 32 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** `.`: anything but a line terminator. */
function isDotCode(code: number): boolean {
  return code !== 10 && code !== 13 && code !== 0x2028 && code !== 0x2029;
}

/** Canonical case of each UTF-16 code unit, filled on first use (`-1` = not yet). */
let canonicalCache: Int32Array | undefined;

/**
 * The case-insensitive canonical form of a code unit without the `u` flag:
 * its single-unit upper case, except that a non-ASCII unit never folds onto
 * an ASCII one.
 */
function canonicalize(code: number): number {
  canonicalCache ??= new Int32Array(0x10000).fill(-1);

  const cached = canonicalCache[code] ?? -1;

  if (cached !== -1) {
    return cached;
  }

  const upper = String.fromCharCode(code).toUpperCase();
  let result = code;

  if (upper.length === 1) {
    const folded = upper.charCodeAt(0);

    result = code >= 128 && folded < 128 ? code : folded;
  }

  canonicalCache[code] = result;

  return result;
}

/** The code units that fold to the same canonical form as `code` and may sit in a class. */
function caseVariants(code: number): number[] {
  const canonical = canonicalize(code);
  const variants = [code];

  if (canonical !== code) {
    variants.push(canonical);
  }

  const lower = String.fromCharCode(code).toLowerCase();

  if (lower.length === 1) {
    const lowerCode = lower.charCodeAt(0);

    if (lowerCode !== code && canonicalize(lowerCode) === canonical) {
      variants.push(lowerCode);
    }
  }

  return variants;
}

// ============================================================
// Parser
// ============================================================

/** One member of a bracket class. */
type ClassItem = { type: "range"; from: number; to: number } | { type: "test"; test: CharTest };

class Parser {
  private index = 0;

  public constructor(
    private readonly source: string,
    private readonly ignoreCase: boolean,
  ) {}

  public parse(): Node {
    const node = this.parseAlternation();

    if (this.index < this.source.length) {
      // Only an unbalanced `)` can stop the top-level parse early, and the
      // built-in engine has already rejected that.
      throw new UnsupportedPatternError(`unexpected "${this.source.charAt(this.index)}"`);
    }

    return node;
  }

  private peek(offset = 0): string {
    return this.source.charAt(this.index + offset);
  }

  private parseAlternation(): Node {
    const options = [this.parseSequence()];

    while (this.peek() === "|") {
      this.index++;
      options.push(this.parseSequence());
    }

    return options.length === 1 ? (options[0] ?? EMPTY) : { type: "alt", options };
  }

  private parseSequence(): Node {
    const items: Node[] = [];

    while (this.index < this.source.length && this.peek() !== "|" && this.peek() !== ")") {
      const atom = this.parseAtom();

      items.push(this.parseQuantifier(atom));
    }

    return items.length === 1 ? (items[0] ?? EMPTY) : { type: "seq", items };
  }

  private parseQuantifier(atom: Node): Node {
    let min: number;
    let max: number;
    const char = this.peek();

    if (char === "*" || char === "+" || char === "?") {
      this.index++;
      min = char === "+" ? 1 : 0;
      max = char === "?" ? 1 : Number.POSITIVE_INFINITY;
    } else if (char === "{") {
      const quantifier = /\{(\d+)(,(\d*))?\}/y;

      quantifier.lastIndex = this.index;

      const bound = quantifier.exec(this.source);

      if (!bound) {
        return atom;
      }

      this.index += bound[0].length;
      min = Number(bound[1]);
      max =
        bound[2] === undefined
          ? min
          : bound[3] === undefined || bound[3] === ""
            ? Number.POSITIVE_INFINITY
            : Number(bound[3]);
    } else {
      return atom;
    }

    // A lazy marker changes which match is reported, never whether one exists.
    if (this.peek() === "?") {
      this.index++;
    }

    return { type: "repeat", node: atom, min, max };
  }

  private parseAtom(): Node {
    const char = this.peek();

    switch (char) {
      case "^":
        this.index++;
        return { type: "assert", assertion: "start" };
      case "$":
        this.index++;
        return { type: "assert", assertion: "end" };
      case ".":
        this.index++;
        return { type: "char", test: isDotCode };
      case "(":
        return this.parseGroup();
      case "[":
        return this.parseClass();
      case "\\":
        return this.parseEscape();
      default:
        this.index++;
        return this.literal(char.charCodeAt(0));
    }
  }

  private parseGroup(): Node {
    this.index++; // `(`

    if (this.peek() === "?") {
      const next = this.peek(1);

      if (next === ":") {
        this.index += 2;
      } else if (next === "=" || next === "!" || (next === "<" && /[=!]/.test(this.peek(2)))) {
        throw new UnsupportedPatternError(
          "lookahead and lookbehind groups ((?=...), (?!...), (?<=...), (?<!...)) are not supported",
        );
      } else if (next === "<") {
        const close = this.source.indexOf(">", this.index);

        this.index = close + 1;
      } else {
        throw new UnsupportedPatternError(`the group syntax "(?${next}" is not supported`);
      }
    }

    const inner = this.parseAlternation();

    this.index++; // `)`

    return inner;
  }

  private literal(code: number): Node {
    if (!this.ignoreCase) {
      return { type: "char", test: (input) => input === code, literal: code };
    }

    const canonical = canonicalize(code);

    return { type: "char", test: (input) => canonicalize(input) === canonical, literal: code };
  }

  /** A class test, folded for case when the pattern ignores case. */
  private classNode(test: CharTest, negated: boolean): Node {
    const folded: CharTest = this.ignoreCase ? (input) => caseVariants(input).some(test) : test;

    return { type: "char", test: negated ? (input) => !folded(input) : folded };
  }

  private parseEscape(): Node {
    this.index++; // `\`

    const char = this.peek();

    switch (char) {
      case "b":
        this.index++;
        return { type: "assert", assertion: "boundary" };
      case "B":
        this.index++;
        return { type: "assert", assertion: "non-boundary" };
      case "d":
      case "D":
      case "w":
      case "W":
      case "s":
      case "S": {
        this.index++;

        const test = classEscapeTest(char.toLowerCase());

        return this.classNode(test, char === char.toUpperCase());
      }
      case "k":
        if (this.peek(1) === "<") {
          throw new UnsupportedPatternError("backreferences (\\k<name>) are not supported");
        }

        break;
      default:
        if (/[1-9]/.test(char)) {
          throw new UnsupportedPatternError(
            "backreferences (\\1 to \\9) are not supported; repeat the text instead",
          );
        }
    }

    return this.literal(this.readCharacterEscape());
  }

  /**
   * Read the escape after a `\` that stands for one character (the
   * cursor is on the character after the backslash). Shared by plain and
   * class escapes.
   */
  private readCharacterEscape(): number {
    const char = this.peek();

    this.index++;

    switch (char) {
      case "n":
        return 10;
      case "r":
        return 13;
      case "t":
        return 9;
      case "v":
        return 11;
      case "f":
        return 12;
      case "c": {
        const letter = this.peek();

        if (/[a-zA-Z]/.test(letter)) {
          this.index++;

          return letter.charCodeAt(0) % 32;
        }

        // `\c` without a letter is a literal backslash followed by `c`.
        this.index--;

        return 92;
      }
      case "x": {
        const hex = /^[0-9a-fA-F]{2}/.exec(this.source.slice(this.index, this.index + 2));

        if (hex) {
          this.index += 2;

          return Number.parseInt(hex[0], 16);
        }

        return 120;
      }
      case "u": {
        const hex = /^[0-9a-fA-F]{4}/.exec(this.source.slice(this.index, this.index + 4));

        if (hex) {
          this.index += 4;

          return Number.parseInt(hex[0], 16);
        }

        return 117;
      }
      case "0": {
        // Legacy octal: `\0` alone is NUL; `\0` followed by octal digits continues it.
        const octal = /^[0-7]{0,2}/.exec(this.source.slice(this.index, this.index + 2));
        const digits = octal?.[0] ?? "";

        this.index += digits.length;

        return Number.parseInt(`0${digits}`, 8);
      }
      default:
        return char.charCodeAt(0);
    }
  }

  private parseClass(): Node {
    this.index++; // `[`

    const negated = this.peek() === "^";

    if (negated) {
      this.index++;
    }

    const items: ClassItem[] = [];

    while (this.index < this.source.length && this.peek() !== "]") {
      const from = this.readClassAtom();

      if (this.peek() === "-" && this.peek(1) !== "]" && this.peek(1) !== "") {
        this.index++; // `-`

        const to = this.readClassAtom();

        if (typeof from === "number" && typeof to === "number") {
          items.push({ type: "range", from, to });

          continue;
        }

        // A class escape on either side makes the `-` literal.
        items.push(classItem(from), { type: "range", from: 45, to: 45 }, classItem(to));

        continue;
      }

      items.push(classItem(from));
    }

    this.index++; // `]`

    const test: CharTest = (code) =>
      items.some((item) =>
        item.type === "range" ? code >= item.from && code <= item.to : item.test(code),
      );

    return this.classNode(test, negated);
  }

  /** One class member: a code unit, or the test of a class escape (`\d`, `\W`, …). */
  private readClassAtom(): number | CharTest {
    const char = this.peek();

    if (char !== "\\") {
      this.index++;

      return char.charCodeAt(0);
    }

    this.index++; // `\`

    const escaped = this.peek();

    if (/[dDwWsS]/.test(escaped)) {
      this.index++;

      const test = classEscapeTest(escaped.toLowerCase());

      return escaped === escaped.toUpperCase() ? (code) => !test(code) : test;
    }

    if (escaped === "b") {
      this.index++;

      return 8;
    }

    if (/[1-7]/.test(escaped)) {
      // Legacy octal escape inside a class.
      const octal = /^[0-7]{1,3}/.exec(this.source.slice(this.index, this.index + 3))?.[0] ?? "";
      const digits = Number.parseInt(octal, 8) > 0o377 ? octal.slice(0, 2) : octal;

      this.index += digits.length;

      return Number.parseInt(digits, 8);
    }

    return this.readCharacterEscape();
  }
}

/** The test behind a lower-case class escape letter. */
function classEscapeTest(letter: string): CharTest {
  return letter === "d" ? isDigitCode : letter === "w" ? isWordCode : isSpaceCode;
}

function classItem(atom: number | CharTest): ClassItem {
  return typeof atom === "number"
    ? { type: "range", from: atom, to: atom }
    : { type: "test", test: atom };
}

// ============================================================
// Compiler
// ============================================================

const OP_CHAR = 0;
const OP_SPLIT = 1;
const OP_JUMP = 2;
const OP_ASSERT = 3;
const OP_MATCH = 4;

/** The compiled program: parallel arrays indexed by state. */
interface Program {
  ops: number[];
  /** `OP_SPLIT` / `OP_JUMP` targets. */
  first: number[];
  second: number[];
  tests: (CharTest | undefined)[];
  assertions: (Assertion | undefined)[];
}

/** States a node compiles to, saturating at `limit + 1`. */
function sizeOf(node: Node, limit: number): number {
  switch (node.type) {
    case "char":
    case "assert":
      return 1;
    case "seq":
      return node.items.reduce(
        (total, item) => Math.min(limit + 1, total + sizeOf(item, limit)),
        0,
      );
    case "alt":
      return Math.min(
        limit + 1,
        node.options.reduce((total, option) => total + sizeOf(option, limit), 0) +
          2 * (node.options.length - 1),
      );
    case "repeat": {
      const inner = sizeOf(node.node, limit);
      const optional =
        node.max === Number.POSITIVE_INFINITY ? inner + 2 : (node.max - node.min) * (inner + 1);

      return Math.min(limit + 1, node.min * inner + optional);
    }
  }
}

function compile(node: Node, maxStates: number): Program {
  if (sizeOf(node, maxStates) + 1 > maxStates) {
    throw new UnsupportedPatternError(
      `the pattern expands to more than ${maxStates} states ` +
        `(large bounded repeats such as {1000}); simplify it`,
    );
  }

  const program: Program = { ops: [], first: [], second: [], tests: [], assertions: [] };

  const emit = (
    op: number,
    extra?: { first?: number; test?: CharTest; assertion?: Assertion },
  ): number => {
    program.ops.push(op);
    program.first.push(extra?.first ?? -1);
    program.second.push(-1);
    program.tests.push(extra?.test);
    program.assertions.push(extra?.assertion);

    return program.ops.length - 1;
  };

  const emitNode = (current: Node): void => {
    switch (current.type) {
      case "char":
        emit(OP_CHAR, { test: current.test });
        return;
      case "assert":
        emit(OP_ASSERT, { assertion: current.assertion });
        return;
      case "seq":
        current.items.forEach(emitNode);
        return;
      case "alt": {
        const jumps: number[] = [];

        current.options.forEach((option, index) => {
          if (index < current.options.length - 1) {
            const split = emit(OP_SPLIT);

            program.first[split] = split + 1;
            emitNode(option);
            jumps.push(emit(OP_JUMP));
            program.second[split] = program.ops.length;
          } else {
            emitNode(option);
          }
        });

        for (const jump of jumps) {
          program.first[jump] = program.ops.length;
        }

        return;
      }
      case "repeat": {
        for (let count = 0; count < current.min; count++) {
          emitNode(current.node);
        }

        if (current.max === Number.POSITIVE_INFINITY) {
          const split = emit(OP_SPLIT);

          program.first[split] = split + 1;
          emitNode(current.node);
          emit(OP_JUMP, { first: split });
          program.second[split] = program.ops.length;

          return;
        }

        const splits: number[] = [];

        for (let count = current.min; count < current.max; count++) {
          const split = emit(OP_SPLIT);

          program.first[split] = split + 1;
          splits.push(split);
          emitNode(current.node);
        }

        for (const split of splits) {
          program.second[split] = program.ops.length;
        }
      }
    }
  };

  emitNode(node);
  emit(OP_MATCH);

  return program;
}

// ============================================================
// Required literal (a cheap pre-check)
// ============================================================

/** The longest run of literal characters every match must contain, or "". */
function requiredLiteral(node: Node): string {
  switch (node.type) {
    case "char":
      return node.literal === undefined ? "" : String.fromCharCode(node.literal);
    case "seq": {
      let best = "";
      let run = "";

      for (const item of node.items) {
        if (item.type === "char" && item.literal !== undefined) {
          run += String.fromCharCode(item.literal);

          continue;
        }

        best = run.length > best.length ? run : best;
        run = "";

        const inner = requiredLiteral(item);

        best = inner.length > best.length ? inner : best;
      }

      return run.length > best.length ? run : best;
    }
    case "repeat":
      return node.min > 0 ? requiredLiteral(node.node) : "";
    default:
      return "";
  }
}

/** Whether the pattern is only literal characters (its required literal is then the answer). */
function isPureLiteral(node: Node): boolean {
  if (node.type === "char") {
    return node.literal !== undefined;
  }

  return node.type === "seq" && node.items.every(isPureLiteral);
}

/**
 * The character tests a match can begin with, found by following every
 * path from the start state without consuming input — treating each
 * assertion as passing, so the set is never too small — plus whether a
 * match can be empty (then no position may be skipped).
 */
function startTests(program: Program): { tests: CharTest[]; canMatchEmpty: boolean } {
  const tests: CharTest[] = [];
  const seen = new Set<number>();
  const stack = [0];
  let canMatchEmpty = false;

  while (stack.length > 0) {
    const state = stack.pop() ?? 0;

    if (seen.has(state)) {
      continue;
    }

    seen.add(state);

    switch (program.ops[state]) {
      case OP_CHAR: {
        const test = program.tests[state];

        if (test !== undefined) {
          tests.push(test);
        }

        break;
      }
      case OP_MATCH:
        canMatchEmpty = true;
        break;
      case OP_JUMP:
        stack.push(program.first[state] ?? 0);
        break;
      case OP_SPLIT:
        stack.push(program.second[state] ?? 0, program.first[state] ?? 0);
        break;
      case OP_ASSERT:
        stack.push(state + 1);
    }
  }

  return { tests, canMatchEmpty };
}

/** Whether every match must start at the beginning of the line. */
function anchoredAtStart(node: Node): boolean {
  switch (node.type) {
    case "assert":
      return node.assertion === "start";
    case "seq": {
      const first = node.items[0];

      return first !== undefined && anchoredAtStart(first);
    }
    case "alt":
      return node.options.every(anchoredAtStart);
    default:
      return false;
  }
}

// ============================================================
// Matcher
// ============================================================

/**
 * Compile `pattern` (JavaScript syntax, optional `i` flag) into a
 * {@link LinearRegex}. Throws the built-in `SyntaxError` for an invalid
 * pattern and {@link UnsupportedPatternError} for a lookaround, a
 * backreference, or a program larger than `maxStates`.
 */
export function compileLinearRegex(pattern: string, options?: LinearRegexOptions): LinearRegex {
  const ignoreCase = options?.ignoreCase ?? false;

  // Compile only (never run) with the built-in engine: identical syntax errors.
  new RegExp(pattern, ignoreCase ? "i" : "");

  const ast = new Parser(pattern, ignoreCase).parse();
  const program = compile(ast, options?.maxStates ?? DEFAULT_MAX_STATES);
  const literal = requiredLiteral(ast);
  const literalCheck: ((text: string) => boolean) | undefined =
    literal === ""
      ? undefined
      : ignoreCase
        ? (
            (check) => (text: string) =>
              check.test(text)
          )(new RegExp(literal.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&"), "i"))
        : (text: string) => text.includes(literal);
  const startOnly = anchoredAtStart(ast);
  const pureLiteral = literalCheck !== undefined && isPureLiteral(ast);
  const { ops, first, second, tests, assertions } = program;
  const start = startTests(program);
  // ASCII answers of the start tests, computed once: 1 = may start here.
  const asciiStarts = new Uint8Array(128);

  for (let code = 0; code < 128; code++) {
    asciiStarts[code] = start.tests.some((test) => test(code)) ? 1 : 0;
  }

  /** Whether a match can begin with this character. */
  const mayStartWith = (code: number): boolean =>
    code < 128 ? asciiStarts[code] === 1 : start.tests.some((test) => test(code));
  const marks = new Int32Array(ops.length);
  const stack: number[] = [];
  let stamp = 0;
  let steps = 0;

  /** Add `state` and everything reachable from it without input, at `position`. */
  const addClosure = (
    list: number[],
    state: number,
    text: string,
    position: number,
    mark: number,
  ): boolean => {
    stack.length = 0;
    stack.push(state);

    while (stack.length > 0) {
      const current = stack.pop() ?? 0;

      if (marks[current] === mark) {
        continue;
      }

      marks[current] = mark;
      steps++;

      switch (ops[current]) {
        case OP_CHAR:
          list.push(current);
          break;
        case OP_MATCH:
          return true;
        case OP_JUMP:
          stack.push(first[current] ?? 0);
          break;
        case OP_SPLIT:
          stack.push(second[current] ?? 0, first[current] ?? 0);
          break;
        case OP_ASSERT:
          if (assertionHolds(assertions[current], text, position)) {
            stack.push(current + 1);
          }
      }
    }

    return false;
  };

  return {
    get steps() {
      return steps;
    },
    size: ops.length,
    test(text: string): boolean {
      if (literalCheck !== undefined && !literalCheck(text)) {
        return false;
      }

      if (pureLiteral) {
        return true;
      }

      // Keep the stamps for this call above every mark already written.
      if (stamp > 0x3fffffff - text.length) {
        marks.fill(0);
        stamp = 0;
      }

      const base = stamp + 1;

      stamp = base + text.length + 1;

      let current: number[] = [];
      let next: number[] = [];

      for (let position = 0; ; position++) {
        if (current.length === 0) {
          if (startOnly && position > 0) {
            return false;
          }

          // No match in progress: jump to the next character a match can begin with.
          if (!start.canMatchEmpty) {
            while (position < text.length && !mayStartWith(text.charCodeAt(position))) {
              steps++;
              position++;
            }
          }
        }

        const mark = base + position;

        if ((position === 0 || !startOnly) && addClosure(current, 0, text, position, mark)) {
          return true;
        }

        if (position === text.length || (startOnly && current.length === 0)) {
          return false;
        }

        const code = text.charCodeAt(position);

        next.length = 0;

        for (const state of current) {
          steps++;

          if (tests[state]?.(code) && addClosure(next, state + 1, text, position + 1, mark + 1)) {
            return true;
          }
        }

        [current, next] = [next, current];
      }
    },
  };
}

/** Whether a zero-width assertion holds at `position` of `text`. */
function assertionHolds(assertion: Assertion | undefined, text: string, position: number): boolean {
  switch (assertion) {
    case "start":
      return position === 0;
    case "end":
      return position === text.length;
    case "boundary":
    case "non-boundary": {
      const before = position > 0 && isWordCode(text.charCodeAt(position - 1));
      const after = position < text.length && isWordCode(text.charCodeAt(position));

      return (before !== after) === (assertion === "boundary");
    }
    default:
      return false;
  }
}
