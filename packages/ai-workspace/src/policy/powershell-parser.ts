import type {
  ShellParseResult,
  ShellRedirect,
  ShellSegment,
  ShellSimpleCommand,
  ShellWord,
} from "./shell-parser";

/**
 * Parser for the PowerShell dialect (`powershell -Command` / `pwsh -Command`).
 *
 * Like the other dialects it is deliberately conservative: it finds every
 * simple command a line would run and every redirection target, and refuses
 * what it cannot read with confidence. Supported: `;` and line breaks, `&&`,
 * `||`, `|`, `$( )` subexpressions (their commands are checked too), the call
 * operator `&` in front of a command, single and double
 * quotes (including the typographic quotes PowerShell treats as quotes),
 * backtick escapes, `$name` / `${name}` / `$env:NAME` variables (dynamic
 * words), and the redirections `>`, `>>`, `2>`, `2>>`, `*>`, `2>&1`.
 *
 * Refused: script blocks and braces, bare parentheses,
 * `@( )` / `@{ }` / splatting / here-strings, the stop-parsing token `--%`,
 * `<` redirection, comments, the comma operator, compound-statement
 * keywords (`if`, `foreach`, `function`, `try`, …), dot-sourcing, a `&` that
 * is not a call operator (background jobs), and type literals.
 */

/** Statement keywords that start a compound command; refused in command position. */
const POWERSHELL_KEYWORDS = new Set([
  "if",
  "elseif",
  "else",
  "switch",
  "foreach",
  "for",
  "while",
  "do",
  "until",
  "function",
  "filter",
  "workflow",
  "param",
  "begin",
  "process",
  "end",
  "try",
  "catch",
  "finally",
  "trap",
  "data",
  "class",
  "enum",
  "using",
  "return",
  "break",
  "continue",
  "throw",
  "parallel",
  "sequence",
  "inlinescript",
]);

/** Characters PowerShell reads as a single quote. */
const SINGLE_QUOTES = "'‘’‚‛";

/** Characters PowerShell reads as a double quote. */
const DOUBLE_QUOTES = '"“”„';

/** Variable-name characters after `$`. */
const VARIABLE_CHAR = /[A-Za-z0-9_:?^$]/;

/** Whether `char` (never the empty end-of-input string) is one of `set`. */
function inSet(set: string, char: string): boolean {
  return char !== "" && set.includes(char);
}

class PowerShellRefusal extends Error {
  public constructor(
    public readonly reason: "unbalanced-quotes" | "unsupported-syntax",
    message: string,
  ) {
    super(message);
  }
}

function unsupported(message: string): PowerShellRefusal {
  return new PowerShellRefusal("unsupported-syntax", message);
}

class PowerShellParser {
  private pos = 0;

  public constructor(
    private readonly src: string,
    public readonly commands: ShellSimpleCommand[] = [],
    private readonly depth = 0,
    private readonly chaining = true,
  ) {}

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  private peek(offset = 0): string {
    return this.src.charAt(this.pos + offset);
  }

  private skipBlanks(): void {
    while (this.peek() === " " || this.peek() === "\t") {
      this.pos++;
    }
  }

  private atLineBreak(): boolean {
    return this.peek() === "\n" || this.peek() === "\r";
  }

  public parseProgram(segments: ShellSegment[]): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipBlanks();

      if (this.atEnd()) {
        if (segments.length === 0) {
          throw unsupported("The command is empty.");
        }

        if (
          segments[segments.length - 1]?.operator === "&&" ||
          segments[segments.length - 1]?.operator === "||"
        ) {
          throw unsupported("The line ends with an operator but no command follows it.");
        }

        return;
      }

      const start = this.pos;

      this.parsePipeline();

      const end = this.pos;

      this.skipBlanks();

      const operator = this.readListOperator();

      segments.push({
        source: this.src.slice(start, end).trim(),
        ...(operator !== null ? { operator } : {}),
      });

      if (operator === null) {
        if (!this.atEnd()) {
          throw unsupported(`Unexpected \`${this.peek()}\`.`);
        }

        return;
      }

      if (operator === ";" || operator === "\n") {
        // Further separators and blanks are allowed after one; a trailing run is fine.
        while (this.peek() === " " || this.peek() === "\t" || this.atLineBreak()) {
          this.pos++;
        }
      } else {
        this.skipBlanks();
      }
    }
  }

  private readListOperator(): string | null {
    const char = this.peek();

    if (
      !this.chaining &&
      ((char === "&" && this.peek(1) === "&") || (char === "|" && this.peek(1) === "|"))
    ) {
      throw unsupported(
        `Windows PowerShell 5.1 cannot run ${char}${char}; use ; or run each command in its own call instead.`,
      );
    }

    if (char === "&" && this.peek(1) === "&") {
      this.pos += 2;

      return "&&";
    }

    if (char === "|" && this.peek(1) === "|") {
      this.pos += 2;

      return "||";
    }

    if (char === ";") {
      this.pos++;

      return ";";
    }

    if (this.atLineBreak()) {
      while (this.atLineBreak()) {
        this.pos++;
      }

      return "\n";
    }

    return null;
  }

  private parsePipeline(): void {
    this.parseCommand();

    while (this.peek() === "|" && this.peek(1) !== "|") {
      this.pos++;
      this.skipBlanks();

      if (this.atEnd() || this.atLineBreak() || this.peek() === ";") {
        throw unsupported("The line ends with `|` but no command follows it.");
      }

      this.parseCommand();
    }
  }

  private atRedirectStart(): boolean {
    const char = this.peek();

    if (char === ">") {
      return true;
    }

    return /[1-6*]/.test(char) && this.peek(1) === ">";
  }

  private parseCommand(): void {
    const start = this.pos;
    const command: ShellSimpleCommand = { assignments: [], words: [], redirects: [], source: "" };
    let callOperator = false;

    if (this.peek() === "&" && this.peek(1) !== "&") {
      callOperator = true;
      this.pos++;
      this.skipBlanks();
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipBlanks();

      if (this.atEnd() || this.atLineBreak() || this.peek() === ";" || this.peek() === "|") {
        break;
      }

      if (this.peek() === "&") {
        if (this.peek(1) === "&") {
          break;
        }

        throw unsupported(
          "`&` is only supported as the call operator in front of a command (not as a background job).",
        );
      }

      if (this.peek() === "<") {
        throw unsupported("`<` is not supported in PowerShell command lines.");
      }

      if (this.atRedirectStart()) {
        command.redirects.push(this.parseRedirect());

        continue;
      }

      const word = this.parseWord();

      command.words.push(word);

      if (command.words.length === 1) {
        this.checkCommandWord(word);
      }
    }

    if (command.words.length === 0 && (callOperator || command.redirects.length === 0)) {
      throw unsupported("The line has an empty command (two operators in a row?).");
    }

    command.source = this.src.slice(start, this.pos).trim();
    this.commands.push(command);
  }

  private checkCommandWord(word: ShellWord): void {
    if (word.raw.startsWith("[")) {
      throw unsupported(`\`${word.raw}\` (a type literal) is not supported.`);
    }

    if (!word.quoted && word.value === ".") {
      throw unsupported(
        "Dot-sourcing (`. file`) runs a script in the current scope and is not supported.",
      );
    }

    if (!word.quoted && POWERSHELL_KEYWORDS.has(word.value.toLowerCase())) {
      throw unsupported(`\`${word.value}\` starts a PowerShell statement, which is not supported.`);
    }
  }

  private parseRedirect(): ShellRedirect {
    let fd: number | undefined;

    if (this.peek() === "*") {
      this.pos++;
    } else if (/[1-6]/.test(this.peek())) {
      fd = Number(this.peek());
      this.pos++;
    }

    let op = ">";

    if (this.peek(1) === ">") {
      op = ">>";
    }

    this.pos += op.length;

    if (op === ">" && this.peek() === "&") {
      if (/[1-6]/.test(this.peek(1))) {
        const target: ShellWord = {
          raw: this.peek(1),
          value: this.peek(1),
          dynamic: false,
          quoted: false,
        };

        this.pos += 2;

        return { op: ">&", ...(fd !== undefined ? { fd } : {}), target, type: "dup" };
      }

      throw unsupported("Only `>&1`-style stream merges (`2>&1`) are supported.");
    }

    this.skipBlanks();

    if (this.atEnd() || this.atLineBreak() || /[;&|<>]/.test(this.peek())) {
      throw unsupported(`The redirection \`${op}\` has no target.`);
    }

    const target = this.parseWord();

    return { op, ...(fd !== undefined ? { fd } : {}), target, type: "write" };
  }

  private parseWord(): ShellWord {
    const start = this.pos;
    let value = "";
    let dynamic = false;
    let quoted = false;

    if (this.src.startsWith("--%", this.pos) && /[\s;|&]|^$/.test(this.src.charAt(this.pos + 3))) {
      throw unsupported("The stop-parsing token `--%` is not supported.");
    }

    while (!this.atEnd()) {
      const char = this.peek();

      if (
        char === " " ||
        char === "\t" ||
        char === "\n" ||
        char === "\r" ||
        char === ";" ||
        char === "|" ||
        char === "&" ||
        char === ">" ||
        char === "<"
      ) {
        break;
      }

      if (inSet(SINGLE_QUOTES, char)) {
        this.pos++;
        quoted = true;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (this.atEnd()) {
            throw new PowerShellRefusal("unbalanced-quotes", "A single quote is never closed.");
          }

          const inner = this.peek();

          if (inSet(SINGLE_QUOTES, inner)) {
            if (inSet(SINGLE_QUOTES, this.peek(1))) {
              value += this.peek(1);
              this.pos += 2;

              continue;
            }

            this.pos++;

            break;
          }

          value += inner;
          this.pos++;
        }

        continue;
      }

      if (inSet(DOUBLE_QUOTES, char)) {
        this.pos++;
        quoted = true;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (this.atEnd()) {
            throw new PowerShellRefusal("unbalanced-quotes", "A double quote is never closed.");
          }

          const inner = this.peek();

          if (inSet(DOUBLE_QUOTES, inner)) {
            if (inSet(DOUBLE_QUOTES, this.peek(1))) {
              value += this.peek(1);
              this.pos += 2;

              continue;
            }

            this.pos++;

            break;
          }

          if (inner === "`") {
            const next = this.peek(1);

            if (next !== "" && (inSet(DOUBLE_QUOTES, next) || next === "`" || next === "$")) {
              value += next;
              this.pos += 2;

              continue;
            }

            throw unsupported(
              'Only `"`, `` ` `` and `$` can follow a backtick inside double quotes.',
            );
          }

          if (inner === "$") {
            const read = this.readVariable();

            value += read;
            dynamic = true;

            continue;
          }

          value += inner;
          this.pos++;
        }

        continue;
      }

      if (char === "`") {
        const next = this.peek(1);

        if (next === "" || next === "\n" || next === "\r") {
          throw unsupported(
            "A backtick at the end of a line (line continuation) is not supported.",
          );
        }

        value += next;
        quoted = true;
        this.pos += 2;

        continue;
      }

      if (char === "$") {
        const wasLiteral = this.src.charAt(this.pos + 1);

        if (
          wasLiteral === "" ||
          !(wasLiteral === "{" || wasLiteral === "(" || VARIABLE_CHAR.test(wasLiteral))
        ) {
          value += "$";
          this.pos++;

          continue;
        }

        value += this.readVariable();
        dynamic = true;

        continue;
      }

      if (char === "@" && this.pos === start) {
        const next = this.peek(1);

        if (
          next === "(" ||
          next === "{" ||
          next === "'" ||
          next === '"' ||
          /[A-Za-z_$]/.test(next)
        ) {
          throw unsupported(
            "Arrays (`@( )`), hashtables, splatting (`@name`) and here-strings are not supported.",
          );
        }
      }

      if (char === "{" || char === "}") {
        throw unsupported("Script blocks and braces are not supported.");
      }

      if (char === "(" || char === ")") {
        throw unsupported(
          "Parentheses (grouping and `$( )` subexpressions) are not supported; quote the text.",
        );
      }

      if (char === ",") {
        throw unsupported(
          "The comma operator builds an array and is not supported; quote the text.",
        );
      }

      if (char === "#" && this.pos === start) {
        throw unsupported("Comments are not supported in a command line.");
      }

      if (char === "*" || char === "?" || char === "[" || (char === "~" && this.pos === start)) {
        dynamic = true;
      }

      value += char;
      this.pos++;
    }

    return { raw: this.src.slice(start, this.pos), value, dynamic, quoted };
  }

  /**
   * Parse a `$( … )` subexpression: its commands run, so they are collected
   * (before the command that contains it) and checked like any other.
   */
  private parseSubexpression(): void {
    if (this.depth >= 8) {
      throw unsupported("`$( )` subexpressions are nested too deeply.");
    }

    const open = this.pos;
    let level = 0;
    let index = open;

    for (; index < this.src.length; index++) {
      const char = this.src.charAt(index);

      if (inSet(SINGLE_QUOTES, char) || inSet(DOUBLE_QUOTES, char)) {
        const set = inSet(SINGLE_QUOTES, char) ? SINGLE_QUOTES : DOUBLE_QUOTES;

        index++;

        while (index < this.src.length) {
          const inner = this.src.charAt(index);

          if (inner === "`" && set === DOUBLE_QUOTES) {
            index += 2;

            continue;
          }

          if (inSet(set, inner)) {
            if (inSet(set, this.src.charAt(index + 1))) {
              index += 2;

              continue;
            }

            break;
          }

          index++;
        }

        continue;
      }

      if (char === "`") {
        index++;

        continue;
      }

      if (char === "(") {
        level++;
      } else if (char === ")") {
        level--;

        if (level === 0) {
          break;
        }
      }
    }

    if (level !== 0) {
      throw new PowerShellRefusal("unbalanced-quotes", "A `$(` subexpression is never closed.");
    }

    const inner = this.src.slice(open + 1, index);

    new PowerShellParser(inner, this.commands, this.depth + 1, this.chaining).parseProgram([]);
    this.pos = index + 1;
  }

  /** Read `$name`, `${name}` or `$env:NAME` at the cursor; a `$(` is refused. */
  private readVariable(): string {
    const begin = this.pos;

    this.pos++;

    if (this.peek() === "(") {
      this.parseSubexpression();

      return this.src.slice(begin, this.pos);
    }

    if (this.peek() === "{") {
      const close = this.src.indexOf("}", this.pos);

      if (close === -1) {
        throw new PowerShellRefusal("unbalanced-quotes", "A `${` variable name is never closed.");
      }

      this.pos = close + 1;

      return this.src.slice(begin, this.pos);
    }

    while (!this.atEnd() && VARIABLE_CHAR.test(this.peek())) {
      this.pos++;
    }

    return this.src.slice(begin, this.pos);
  }
}

/** Parse a PowerShell command line for the shell policy. Never throws. */
export function parsePowerShellLine(
  line: string,
  options?: { chaining?: boolean },
): ShellParseResult {
  const segments: ShellSegment[] = [];
  const parser = new PowerShellParser(line, [], 0, options?.chaining !== false);

  try {
    parser.parseProgram(segments);

    return { ok: true, commands: parser.commands, segments, background: false };
  } catch (error) {
    if (error instanceof PowerShellRefusal) {
      return { ok: false, reason: error.reason, message: error.message };
    }

    throw error;
  }
}
