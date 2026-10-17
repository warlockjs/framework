/**
 * A deliberately conservative parser for the command lines `run_shell`
 * hands to a shell when the policy opts in to `interpreter: "sh"`.
 *
 * Its only job is to find **every simple command** a line would run — so
 * the policy can check each one — plus every redirection target. It is not
 * a shell: it never expands anything. What it cannot read with confidence
 * it refuses, because a construct the parser misreads is a construct a
 * denied command can hide in. `/bin/sh` is bash on some systems, dash or
 * busybox ash on others, so constructs that those shells read differently
 * (bash-only syntax such as `<<<`, `&>`, `$'…'`, brace expansion, `[[`,
 * arithmetic) are refused as well.
 *
 * Two dialects:
 * - `"posix"` — what `/bin/sh -c` reads: `;`, `&&`, `||`, `|`, `&`,
 *   newlines, comments, `( … )` subshells, `$( … )` and backtick command
 *   substitution (parsed recursively), `$name` / `${name…}` parameter
 *   expansion (a restricted set of forms), single and double quotes,
 *   backslash escapes, redirections and here-documents.
 * - `"cmd"` — what `cmd.exe /d /v:off /s /c` reads, restricted to the
 *   subset whose meaning is unambiguous: `&&`, `||`, `|`, `&` (sequential
 *   in cmd), double quotes and simple redirections. `%`, `!`, `^`,
 *   parentheses, `;` and `,` are refused.
 */

/** Which shell grammar to parse. */
export type ShellDialect = "posix" | "cmd";

/** One word of a simple command, after quote removal. */
export interface ShellWord {
  /** The word exactly as written. */
  raw: string;
  /**
   * The word's text after quote removal and escapes. Expansions
   * (`$HOME`, `$(…)`, backticks) are kept as their source text — their real
   * value is only known when the shell runs.
   */
  value: string;
  /**
   * True when the shell decides part of the word at run time: a parameter
   * expansion, a command substitution, an unquoted glob character
   * (`*`, `?`, `[`) or a leading `~`.
   */
  dynamic: boolean;
  /** True when any part of the word was quoted or escaped. */
  quoted: boolean;
  /** For a `NAME=value` assignment word, the variable name. */
  assignmentName?: string;
}

/** A redirection attached to a simple command (or a subshell). */
export interface ShellRedirect {
  /** The operator: `>`, `>>`, `>|`, `<`, `<>`, `>&`, `<&`, `<<` or `<<-`. */
  op: string;
  /** Explicit file descriptor (`2>`), when written. */
  fd?: number;
  /** The target word (file, descriptor number or here-doc delimiter). */
  target: ShellWord;
  /**
   * `"read"` / `"write"` — a file target; `"dup"` — a descriptor copy or
   * close (`2>&1`, `>&-`); `"heredoc"` — inline input.
   */
  type: "read" | "write" | "dup" | "heredoc";
}

/** A simple command: assignments, words and redirections. */
export interface ShellSimpleCommand {
  /** Leading `NAME=value` words. */
  assignments: ShellWord[];
  /** The command's words — `words[0]` is the command name. Empty for a redirect- or assignment-only command. */
  words: ShellWord[];
  /** Redirections, in order. */
  redirects: ShellRedirect[];
  /** The command's source text (for messages). */
  source: string;
}

/** A top-level piece of the line and the operator that follows it. */
export interface ShellSegment {
  /** Source text of the pipeline. */
  source: string;
  /** The list operator after it (`&&`, `||`, `;`, `&`, a newline), if any. */
  operator?: string;
}

/** Outcome of {@link parseShellLine}. */
export type ShellParseResult =
  | {
      ok: true;
      /** Every simple command, in the order the shell meets them (substitutions first). */
      commands: ShellSimpleCommand[];
      /** The top-level pipelines and the operators joining them. */
      segments: ShellSegment[];
      /** True when the line backgrounds anything with `&` (POSIX dialect). */
      background: boolean;
    }
  | {
      ok: false;
      /** Why the line was refused. */
      reason: "unbalanced-quotes" | "unsupported-syntax";
      /** What was refused and why, for the model. */
      message: string;
    };

/** Deepest nesting of subshells and substitutions the parser accepts. */
const MAX_NESTING = 16;

/**
 * Words that start a compound command (or negate a pipeline) when they
 * appear unquoted in command position. The parser does not read compound
 * commands, so a line using one is refused.
 */
const RESERVED_WORDS = new Set([
  "!",
  "{",
  "}",
  "[[",
  "]]",
  "case",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "until",
  "while",
]);

/** cmd.exe keywords the `"cmd"` dialect refuses in command position. */
const CMD_RESERVED_WORDS = new Set(["if", "for", "goto", "setlocal", "endlocal"]);

/** A parameter name inside `${…}`: a variable, a positional or a special parameter. */
const PARAMETER_NAME = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!-])`;

/**
 * The default/pattern word of `${name:-word}` / `${name%word}`: no quotes,
 * no nested expansion or substitution, no braces or parentheses, no `@`.
 */
const PARAMETER_WORD = "[^`$'\"\\\\{}()@\\n]*";

/**
 * Allowed `${…}` forms: `${name}`, `${#name}`, `${name-word}`,
 * `${name:-word}` (also `=`, `+`, `?`), `${name%word}`, `${name%%word}`,
 * `${name#word}`, `${name##word}`. Everything else — substrings and
 * subscripts (arithmetic in bash), `${!name}`, `${name@op}`, pattern
 * substitution — is refused.
 */
const PARAMETER_EXPANSION = new RegExp(
  `^(?:#${PARAMETER_NAME}|${PARAMETER_NAME}(?:(?::?[-=+?]|%%?|##?)${PARAMETER_WORD})?)$`,
);

/** A refusal raised while parsing; caught by {@link parseShellLine}. */
class ShellSyntaxRefusal extends Error {
  public constructor(
    public readonly reason: "unbalanced-quotes" | "unsupported-syntax",
    message: string,
  ) {
    super(message);
  }
}

/** Refuse a construct the parser does not read with confidence. */
function unsupported(message: string): ShellSyntaxRefusal {
  return new ShellSyntaxRefusal("unsupported-syntax", message);
}

/** Refuse an unterminated quote / substitution. */
function unbalanced(message: string): ShellSyntaxRefusal {
  return new ShellSyntaxRefusal("unbalanced-quotes", message);
}

/** State shared by a parser and the nested parsers it starts (backticks, here-docs). */
interface SharedState {
  commands: ShellSimpleCommand[];
  background: boolean;
  nesting: number;
}

/** A here-document whose body starts after the next newline. */
interface PendingHeredoc {
  delimiter: string;
  stripTabs: boolean;
  expand: boolean;
}

/** Parser for the POSIX `sh` dialect. */
class PosixParser {
  private pos = 0;

  private pendingHeredocs: PendingHeredoc[] = [];

  public constructor(
    private readonly src: string,
    private readonly state: SharedState,
  ) {}

  /** Parse the whole line as a command list. */
  public parseProgram(segments: ShellSegment[]): void {
    this.parseList(null, segments);
    this.assertNoPendingHeredocs();
  }

  /** Parse the contents of a backtick substitution (a full list until EOF). */
  public parseNestedProgram(): void {
    this.parseList(null, undefined);
    this.assertNoPendingHeredocs();
  }

  /**
   * Scan an unquoted-delimiter here-document body: `$…`, `${…}`, `$(…)` and
   * backticks expand there exactly as inside double quotes (but `"` is an
   * ordinary character), so any command substitution in it runs.
   */
  public parseExpandingText(): void {
    while (!this.atEnd()) {
      const char = this.peek();

      if (char === "\\") {
        this.pos += 2;

        continue;
      }

      if (char === "$") {
        this.parseDollar("heredoc");

        continue;
      }

      if (char === "`") {
        this.parseBackticks(false);

        continue;
      }

      this.pos++;
    }
  }

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  private peek(offset = 0): string {
    return this.src.charAt(this.pos + offset);
  }

  private assertNoPendingHeredocs(): void {
    if (this.pendingHeredocs.length > 0) {
      throw unsupported(
        `The here-document delimited by \`${this.pendingHeredocs[0]?.delimiter ?? ""}\` is never terminated.`,
      );
    }
  }

  private enterNesting(): void {
    this.state.nesting++;

    if (this.state.nesting > MAX_NESTING) {
      throw unsupported("The line nests subshells or substitutions too deeply.");
    }
  }

  private exitNesting(): void {
    this.state.nesting--;
  }

  /** Skip spaces, tabs and backslash-newline continuations. */
  private skipBlanks(): void {
    while (!this.atEnd()) {
      const char = this.peek();

      if (char === " " || char === "\t") {
        this.pos++;

        continue;
      }

      if (char === "\\" && this.peek(1) === "\n") {
        this.pos += 2;

        continue;
      }

      break;
    }
  }

  /** Skip a `#` comment up to (not including) the newline. */
  private skipComment(): void {
    const newline = this.src.indexOf("\n", this.pos);

    this.pos = newline === -1 ? this.src.length : newline;
  }

  /** Consume one newline and read any here-document bodies queued before it. */
  private consumeNewline(): void {
    this.pos++;

    if (this.pendingHeredocs.length === 0) {
      return;
    }

    if (this.state.nesting > 0) {
      throw unsupported("Here-documents inside subshells or substitutions are not supported.");
    }

    const pending = this.pendingHeredocs;

    this.pendingHeredocs = [];

    for (const heredoc of pending) {
      this.readHeredocBody(heredoc);
    }
  }

  /** Skip blanks, comments and newlines (separators between commands). */
  private skipBlanksAndNewlines(): void {
    while (!this.atEnd()) {
      this.skipBlanks();

      if (this.peek() === "#") {
        this.skipComment();

        continue;
      }

      if (this.peek() === "\n") {
        this.consumeNewline();

        continue;
      }

      break;
    }
  }

  private readHeredocBody(heredoc: PendingHeredoc): void {
    const bodyLines: string[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.atEnd()) {
        throw unsupported(
          `The here-document delimited by \`${heredoc.delimiter}\` is never terminated.`,
        );
      }

      const lineEnd = this.src.indexOf("\n", this.pos);
      const line = lineEnd === -1 ? this.src.slice(this.pos) : this.src.slice(this.pos, lineEnd);
      const compared = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;

      this.pos = lineEnd === -1 ? this.src.length : lineEnd + 1;

      if (compared === heredoc.delimiter) {
        break;
      }

      bodyLines.push(compared);
    }

    if (heredoc.expand) {
      new PosixParser(bodyLines.join("\n"), this.state).parseExpandingText();
    }
  }

  /**
   * Parse a command list until `closing` (`")"`) or the end of the input.
   * `segments`, when given, collects the top-level pipelines.
   */
  private parseList(closing: string | null, segments: ShellSegment[] | undefined): void {
    let sawCommand = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipBlanksAndNewlines();

      if (this.atEnd()) {
        if (closing !== null) {
          throw unbalanced(`A \`(\` or \`$(\` is never closed with \`${closing}\`.`);
        }

        break;
      }

      if (closing !== null && this.peek() === closing) {
        break;
      }

      const start = this.pos;

      this.parsePipeline(closing);

      const end = this.pos;

      sawCommand = true;
      this.skipBlanks();

      if (this.peek() === "#") {
        this.skipComment();
      }

      const operator = this.readListOperator();

      segments?.push({
        source: this.src.slice(start, end).trim(),
        ...(operator !== null ? { operator } : {}),
      });

      if (operator === "&&" || operator === "||") {
        this.skipBlanksAndNewlines();

        if (this.atEnd() || (closing !== null && this.peek() === closing)) {
          throw unsupported(`The line ends with \`${operator}\` but no command follows it.`);
        }

        continue;
      }

      if (operator === "&") {
        this.state.background = true;
      }

      if (operator === null) {
        if (this.atEnd() || (closing !== null && this.peek() === closing)) {
          break;
        }

        throw unsupported(`Unexpected \`${this.peek()}\`.`);
      }
    }

    if (!sawCommand) {
      throw unsupported(closing === null ? "The command is empty." : "A `( )` or `$( )` is empty.");
    }
  }

  /** Read `&&`, `||`, `;`, `&` or a newline after a pipeline. */
  private readListOperator(): string | null {
    const char = this.peek();
    const next = this.peek(1);

    if (char === "&") {
      if (next === "&") {
        this.pos += 2;

        return "&&";
      }

      if (next === ">") {
        throw unsupported(
          "`&>` (redirect both streams) is not portable; write `> file 2>&1` instead.",
        );
      }

      this.pos++;

      return "&";
    }

    if (char === "|" && next === "|") {
      this.pos += 2;

      return "||";
    }

    if (char === ";") {
      if (next === ";") {
        throw unsupported("`;;` (a `case` clause) is not supported.");
      }

      this.pos++;

      return ";";
    }

    if (char === "\n") {
      this.consumeNewline();

      return "\n";
    }

    return null;
  }

  private parsePipeline(closing: string | null): void {
    this.parseCommand(closing);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipBlanks();

      if (this.peek() !== "|" || this.peek(1) === "|") {
        return;
      }

      if (this.peek(1) === "&") {
        throw unsupported("`|&` is not portable; write `2>&1 |` instead.");
      }

      this.pos++;
      this.skipBlanksAndNewlines();

      if (this.atEnd() || (closing !== null && this.peek() === closing)) {
        throw unsupported("The line ends with `|` but no command follows it.");
      }

      this.parseCommand(closing);
    }
  }

  private parseCommand(closing: string | null): void {
    this.skipBlanks();

    if (this.peek() === "(") {
      if (this.peek(1) === "(") {
        throw unsupported("`((…))` (arithmetic) is not supported.");
      }

      this.parseSubshell();

      return;
    }

    if (this.peek() === ")") {
      throw unsupported(closing === null ? "Unexpected `)`." : "A `( )` or `$( )` is empty.");
    }

    this.parseSimpleCommand();
  }

  private parseSubshell(): void {
    const start = this.pos;

    this.pos++;
    this.enterNesting();
    this.parseList(")", undefined);

    if (this.peek() !== ")") {
      throw unbalanced("A `(` is never closed with `)`.");
    }

    this.pos++;
    this.exitNesting();

    // Redirections may follow the closing parenthesis; nothing else may.
    const redirects: ShellRedirect[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipBlanks();

      if (!this.atRedirectStart()) {
        break;
      }

      redirects.push(this.parseRedirect());
    }

    if (redirects.length > 0) {
      this.state.commands.push({
        assignments: [],
        words: [],
        redirects,
        source: this.src.slice(start, this.pos).trim(),
      });
    }

    if (!this.atEnd() && !this.atOperatorBoundary()) {
      throw unsupported("Only an operator or a redirection may follow `)`.");
    }
  }

  /** Whether the next character ends a simple command. */
  private atOperatorBoundary(): boolean {
    const char = this.peek();

    return (
      char === "\n" ||
      char === ";" ||
      char === "&" ||
      char === "|" ||
      char === ")" ||
      char === "#" ||
      char === " " ||
      char === "\t"
    );
  }

  /** Whether a redirection starts here (`>`, `<`, or digits glued to one). */
  private atRedirectStart(): boolean {
    let index = this.pos;

    while (index < this.src.length && /[0-9]/.test(this.src.charAt(index))) {
      index++;
    }

    const char = this.src.charAt(index);

    return char === "<" || char === ">";
  }

  private parseSimpleCommand(): void {
    const start = this.pos;
    const command: ShellSimpleCommand = { assignments: [], words: [], redirects: [], source: "" };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipBlanks();

      if (this.atEnd()) {
        break;
      }

      const char = this.peek();

      if (char === "\n" || char === ";" || char === "&" || char === "|" || char === ")") {
        break;
      }

      if (char === "(") {
        throw unsupported(
          "`(` is only supported at the start of a command (a subshell); quote it to pass it as text.",
        );
      }

      if (char === "#") {
        this.skipComment();

        break;
      }

      if (this.atRedirectStart()) {
        command.redirects.push(this.parseRedirect());

        continue;
      }

      const word = this.parseWord();

      if (command.words.length === 0 && word.assignmentName !== undefined) {
        command.assignments.push(word);

        continue;
      }

      command.words.push(word);

      if (command.words.length === 1 && !word.quoted && RESERVED_WORDS.has(word.value)) {
        throw unsupported(
          `\`${word.value}\` starts a shell compound command, which is not supported; run the commands one at a time.`,
        );
      }
    }

    if (
      command.words.length === 0 &&
      command.assignments.length === 0 &&
      command.redirects.length === 0
    ) {
      throw unsupported("The line has an empty command (two operators in a row?).");
    }

    command.source = this.src.slice(start, this.pos).trim();
    this.state.commands.push(command);
  }

  private parseRedirect(): ShellRedirect {
    let digits = "";

    while (/[0-9]/.test(this.peek())) {
      digits += this.peek();
      this.pos++;
    }

    const rest = this.src.slice(this.pos, this.pos + 3);
    let op: string;

    if (rest.startsWith("<<<")) {
      throw unsupported("`<<<` (a here-string) is not portable; use a here-document.");
    } else if (rest.startsWith("<<-")) {
      op = "<<-";
    } else if (rest.startsWith("<<")) {
      op = "<<";
    } else if (rest.startsWith("<>")) {
      op = "<>";
    } else if (rest.startsWith("<&")) {
      op = "<&";
    } else if (rest.startsWith("<(") || rest.startsWith(">(")) {
      throw unsupported("Process substitution (`<(…)`, `>(…)`) is not supported.");
    } else if (rest.startsWith(">>")) {
      op = ">>";
    } else if (rest.startsWith(">|")) {
      op = ">|";
    } else if (rest.startsWith(">&")) {
      op = ">&";
    } else {
      op = this.peek();
    }

    this.pos += op.length;

    const fd = digits === "" ? undefined : Number(digits);

    this.skipBlanks();

    if (this.atEnd() || /[\n;&|<>()]/.test(this.peek())) {
      throw unsupported(`The redirection \`${op}\` has no target.`);
    }

    const target = this.parseWord();

    if (op === "<<" || op === "<<-") {
      if (this.state.nesting > 0) {
        throw unsupported("Here-documents inside subshells or substitutions are not supported.");
      }

      if (target.dynamic) {
        throw unsupported("A here-document delimiter must be literal text.");
      }

      this.pendingHeredocs.push({
        delimiter: target.value,
        stripTabs: op === "<<-",
        expand: !target.quoted,
      });

      return { op, ...(fd !== undefined ? { fd } : {}), target, type: "heredoc" };
    }

    if (op === ">&" || op === "<&") {
      if (target.dynamic || !/^(?:[0-9]+|-)$/.test(target.value)) {
        throw unsupported(
          `\`${op}${target.raw}\` is not portable; write \`> file 2>&1\` to send both streams to a file.`,
        );
      }

      return { op, ...(fd !== undefined ? { fd } : {}), target, type: "dup" };
    }

    return {
      op,
      ...(fd !== undefined ? { fd } : {}),
      target,
      type: op === "<" ? "read" : "write",
    };
  }

  /** Parse one unquoted-context word. */
  private parseWord(): ShellWord {
    const start = this.pos;
    let value = "";
    let dynamic = false;
    let quoted = false;
    let braces = false;
    let nameCandidate = true;
    let assignmentName: string | undefined;

    while (!this.atEnd()) {
      const char = this.peek();

      if (
        char === " " ||
        char === "\t" ||
        char === "\n" ||
        char === ";" ||
        char === "&" ||
        char === "|" ||
        char === "<" ||
        char === ">" ||
        char === "(" ||
        char === ")"
      ) {
        break;
      }

      if (char === "\r" || char === "\0") {
        throw unsupported("Carriage returns and NUL bytes are not supported in a command line.");
      }

      if (char === "\\") {
        const next = this.peek(1);

        if (next === "") {
          throw unsupported("The line ends with a backslash.");
        }

        this.pos += 2;

        if (next !== "\n") {
          value += next;
          quoted = true;
          nameCandidate = false;
        }

        continue;
      }

      if (char === "'") {
        const closing = this.src.indexOf("'", this.pos + 1);

        if (closing === -1) {
          throw unbalanced("A `'` quote is never closed.");
        }

        value += this.src.slice(this.pos + 1, closing);
        quoted = true;
        nameCandidate = false;
        this.pos = closing + 1;

        continue;
      }

      if (char === '"') {
        const part = this.parseDoubleQuoted();

        value += part.value;
        dynamic = dynamic || part.dynamic;
        quoted = true;
        nameCandidate = false;

        continue;
      }

      if (char === "$") {
        const part = this.parseDollar("unquoted");

        value += part.text;
        dynamic = dynamic || part.dynamic;
        nameCandidate = false;

        continue;
      }

      if (char === "`") {
        value += this.parseBackticks(false);
        dynamic = true;
        nameCandidate = false;

        continue;
      }

      if (char === "=" && nameCandidate && assignmentName === undefined) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
          assignmentName = value;
        }

        nameCandidate = false;
      } else if (!/[A-Za-z0-9_]/.test(char)) {
        nameCandidate = false;
      }

      if (char === "*" || char === "?" || char === "[") {
        dynamic = true;
      }

      if (char === "~") {
        const previous = this.src.charAt(this.pos - 1);

        if (
          this.pos === start ||
          (assignmentName !== undefined && (previous === "=" || previous === ":"))
        ) {
          dynamic = true;
        }
      }

      if (char === "{" || char === "}") {
        braces = true;
      }

      value += char;
      this.pos++;
    }

    const raw = this.src.slice(start, this.pos);

    if (braces && raw !== "{}") {
      throw unsupported(
        `Unquoted \`{\` or \`}\` in \`${raw}\` (brace expansion or a command group) is not supported; quote it.`,
      );
    }

    // A lone `[` or `]` is never a glob (it is the `test` command or its end).
    if (raw === "[" || raw === "]") {
      dynamic = false;
    }

    return {
      raw,
      value,
      dynamic,
      quoted,
      ...(assignmentName !== undefined ? { assignmentName } : {}),
    };
  }

  /** Parse a `"…"` span (cursor on the opening quote). */
  private parseDoubleQuoted(): { value: string; dynamic: boolean } {
    this.pos++;

    let value = "";
    let dynamic = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.atEnd()) {
        throw unbalanced('A `"` quote is never closed.');
      }

      const char = this.peek();

      if (char === '"') {
        this.pos++;

        return { value, dynamic };
      }

      if (char === "\0") {
        throw unsupported("NUL bytes are not supported in a command line.");
      }

      if (char === "\\") {
        const next = this.peek(1);

        if (next === "") {
          throw unbalanced('A `"` quote is never closed.');
        }

        if (next === "$" || next === "`" || next === '"' || next === "\\") {
          value += next;
          this.pos += 2;

          continue;
        }

        if (next === "\n") {
          this.pos += 2;

          continue;
        }

        value += char;
        this.pos++;

        continue;
      }

      if (char === "$") {
        const part = this.parseDollar("dquote");

        value += part.text;
        dynamic = dynamic || part.dynamic;

        continue;
      }

      if (char === "`") {
        value += this.parseBackticks(true);
        dynamic = true;

        continue;
      }

      value += char;
      this.pos++;
    }
  }

  /** Parse a `$…` expansion (cursor on the `$`). */
  private parseDollar(context: "unquoted" | "dquote" | "heredoc"): {
    text: string;
    dynamic: boolean;
  } {
    const start = this.pos;
    const next = this.peek(1);

    if (next === "(") {
      if (this.peek(2) === "(") {
        throw unsupported("`$((…))` (arithmetic expansion) is not supported.");
      }

      this.pos += 2;
      this.enterNesting();
      this.parseList(")", undefined);

      if (this.peek() !== ")") {
        throw unbalanced("A `$(` is never closed with `)`.");
      }

      this.pos++;
      this.exitNesting();

      return { text: this.src.slice(start, this.pos), dynamic: true };
    }

    if (next === "{") {
      const closing = this.src.indexOf("}", this.pos + 2);

      if (closing === -1) {
        throw unbalanced("A `${` is never closed with `}`.");
      }

      const body = this.src.slice(this.pos + 2, closing);

      if (!PARAMETER_EXPANSION.test(body)) {
        throw unsupported(
          `\`\${${body}}\` is not a supported parameter expansion; use \`$name\`, \`\${name}\` or \`\${name:-default}\`.`,
        );
      }

      this.pos = closing + 1;

      return { text: this.src.slice(start, this.pos), dynamic: true };
    }

    if (next === "[") {
      throw unsupported("`$[…]` (arithmetic expansion) is not supported.");
    }

    if (context === "unquoted" && (next === "'" || next === '"')) {
      throw unsupported(`\`$${next}…${next}\` quoting is not portable; use plain quotes.`);
    }

    if (/[A-Za-z_]/.test(next)) {
      this.pos += 2;

      while (/[A-Za-z0-9_]/.test(this.peek())) {
        this.pos++;
      }

      return { text: this.src.slice(start, this.pos), dynamic: true };
    }

    if (/[0-9@*#?$!-]/.test(next) && next !== "") {
      this.pos += 2;

      return { text: this.src.slice(start, this.pos), dynamic: true };
    }

    // A `$` followed by anything else is an ordinary character.
    this.pos++;

    return { text: "$", dynamic: false };
  }

  /** Parse a backtick substitution (cursor on the opening backtick); returns its source. */
  private parseBackticks(insideDoubleQuotes: boolean): string {
    const start = this.pos;
    let content = "";

    this.pos++;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.atEnd()) {
        throw unbalanced("A backtick substitution is never closed.");
      }

      const char = this.peek();

      if (char === "`") {
        this.pos++;

        break;
      }

      if (char === "\\") {
        const next = this.peek(1);

        if (next === "") {
          throw unbalanced("A backtick substitution is never closed.");
        }

        if (next === "`" || next === "\\" || next === "$") {
          content += next;
          this.pos += 2;

          continue;
        }

        if (next === '"' && insideDoubleQuotes) {
          throw unsupported(
            'An escaped `\\"` inside backticks inside double quotes is not portable; use `$(…)`.',
          );
        }

        content += char + next;
        this.pos += 2;

        continue;
      }

      content += char;
      this.pos++;
    }

    this.enterNesting();
    new PosixParser(content, this.state).parseNestedProgram();
    this.exitNesting();

    return this.src.slice(start, this.pos);
  }
}

/** Parser for the restricted `cmd.exe` dialect. */
class CmdParser {
  private pos = 0;

  public constructor(
    private readonly src: string,
    private readonly commands: ShellSimpleCommand[],
  ) {}

  public parseProgram(segments: ShellSegment[]): void {
    if (/[\r\n\0]/.test(this.src)) {
      throw unsupported("Line breaks and NUL bytes are not supported in a cmd.exe command line.");
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipBlanks();

      if (this.atEnd()) {
        throw unsupported(
          segments.length === 0
            ? "The command is empty."
            : "The line ends with an operator but no command follows it.",
        );
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
    }
  }

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

  private readListOperator(): string | null {
    if (this.peek() === "&") {
      if (this.peek(1) === "&") {
        this.pos += 2;

        return "&&";
      }

      this.pos++;

      return "&";
    }

    if (this.peek() === "|" && this.peek(1) === "|") {
      this.pos += 2;

      return "||";
    }

    return null;
  }

  private parsePipeline(): void {
    this.parseSimpleCommand();

    while (this.peek() === "|" && this.peek(1) !== "|") {
      this.pos++;
      this.skipBlanks();

      if (this.atEnd()) {
        throw unsupported("The line ends with `|` but no command follows it.");
      }

      this.parseSimpleCommand();
    }
  }

  private atRedirectStart(): boolean {
    const char = this.peek();

    if (char === "<" || char === ">") {
      return true;
    }

    return /[0-9]/.test(char) && (this.peek(1) === ">" || this.peek(1) === "<");
  }

  private parseSimpleCommand(): void {
    const start = this.pos;
    const command: ShellSimpleCommand = { assignments: [], words: [], redirects: [], source: "" };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipBlanks();

      if (this.atEnd() || this.peek() === "&" || this.peek() === "|") {
        break;
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

    if (command.words.length === 0 && command.redirects.length === 0) {
      throw unsupported("The line has an empty command (two operators in a row?).");
    }

    command.source = this.src.slice(start, this.pos).trim();
    this.commands.push(command);
  }

  private checkCommandWord(word: ShellWord): void {
    if (word.raw.startsWith("@") || word.raw.startsWith(":")) {
      throw unsupported(`\`${word.raw}\` is not supported as a cmd.exe command name.`);
    }

    if (/[/=]/.test(word.value)) {
      throw unsupported(
        `A cmd.exe command name may not contain \`/\` or \`=\` (\`${word.value}\`); use \`\\\` in paths.`,
      );
    }

    if (!word.quoted && CMD_RESERVED_WORDS.has(word.value.toLowerCase())) {
      throw unsupported(
        `\`${word.value}\` starts a cmd.exe compound command, which is not supported.`,
      );
    }
  }

  private parseRedirect(): ShellRedirect {
    let fd: number | undefined;

    if (/[0-9]/.test(this.peek())) {
      fd = Number(this.peek());
      this.pos++;
    }

    let op: string;

    if (this.src.startsWith(">>", this.pos)) {
      op = ">>";
    } else if (this.src.startsWith(">&", this.pos)) {
      op = ">&";
    } else if (this.src.startsWith("<&", this.pos) || this.src.startsWith("<<", this.pos)) {
      throw unsupported(
        `\`${this.src.slice(this.pos, this.pos + 2)}\` is not supported by cmd.exe.`,
      );
    } else {
      op = this.peek();
    }

    this.pos += op.length;
    this.skipBlanks();

    if (this.atEnd() || /[&|<>]/.test(this.peek())) {
      throw unsupported(`The redirection \`${op}\` has no target.`);
    }

    const target = this.parseWord();

    if (op === ">&") {
      if (!/^[0-9]$/.test(target.value)) {
        throw unsupported(`\`>&${target.raw}\` is not supported; write \`> file 2>&1\`.`);
      }

      return { op, ...(fd !== undefined ? { fd } : {}), target, type: "dup" };
    }

    return { op, ...(fd !== undefined ? { fd } : {}), target, type: op === "<" ? "read" : "write" };
  }

  private parseWord(): ShellWord {
    const start = this.pos;
    let value = "";
    let dynamic = false;
    let quoted = false;

    while (!this.atEnd()) {
      const char = this.peek();

      if (
        char === " " ||
        char === "\t" ||
        char === "&" ||
        char === "|" ||
        char === "<" ||
        char === ">"
      ) {
        break;
      }

      if (char === '"') {
        const closing = this.src.indexOf('"', this.pos + 1);

        if (closing === -1) {
          throw unbalanced('A `"` quote is never closed.');
        }

        const inner = this.src.slice(this.pos + 1, closing);

        if (/[%!]/.test(inner)) {
          throw unsupported(
            "`%` and `!` expand even inside quotes in cmd.exe; they are not supported.",
          );
        }

        if (value.endsWith("\\") || inner.endsWith("\\")) {
          throw unsupported(
            'A backslash before a `"` is read differently by cmd.exe and programs.',
          );
        }

        value += inner;
        quoted = true;
        this.pos = closing + 1;

        continue;
      }

      if (
        char === "%" ||
        char === "!" ||
        char === "^" ||
        char === "(" ||
        char === ")" ||
        char === ";" ||
        char === ","
      ) {
        throw unsupported(
          `Unquoted \`${char}\` has a special meaning in cmd.exe and is not supported.`,
        );
      }

      if (char === "\\" && this.peek(1) === '"') {
        throw unsupported('A backslash before a `"` is read differently by cmd.exe and programs.');
      }

      if (char === "*" || char === "?") {
        dynamic = true;
      }

      value += char;
      this.pos++;
    }

    return { raw: this.src.slice(start, this.pos), value, dynamic, quoted };
  }
}

/**
 * Parse a command line for the shell policy. Never throws: a construct the
 * parser does not read with confidence comes back as `{ ok: false }` with a
 * message naming it.
 *
 * @example
 * const parsed = parseShellLine("git add -A && git commit -m 'wip'", "posix");
 * // parsed.ok === true; parsed.commands.map((c) => c.words.map((w) => w.value))
 * // → [["git", "add", "-A"], ["git", "commit", "-m", "wip"]]
 */
export function parseShellLine(line: string, dialect: ShellDialect): ShellParseResult {
  const segments: ShellSegment[] = [];

  try {
    if (dialect === "cmd") {
      const commands: ShellSimpleCommand[] = [];

      new CmdParser(line, commands).parseProgram(segments);

      return { ok: true, commands, segments, background: false };
    }

    const state: SharedState = { commands: [], background: false, nesting: 0 };

    new PosixParser(line, state).parseProgram(segments);

    return { ok: true, commands: state.commands, segments, background: state.background };
  } catch (error) {
    if (error instanceof ShellSyntaxRefusal) {
      return { ok: false, reason: error.reason, message: error.message };
    }

    throw error;
  }
}
