import path from "node:path";
import type { WorkspaceShellRefusalReason } from "../errors";
import type {
  WorkspaceCommandPattern,
  WorkspaceCommandRule,
  WorkspacePolicy,
  WorkspaceShellAsk,
  WorkspaceShellClassification,
  WorkspaceShellPolicy,
} from "../contracts";
import { isInsideJailLexically } from "./jail";
import {
  canonicalPowerShellArgv,
  normalizePowerShellCd,
  POWERSHELL_CD_NAMES,
  POWERSHELL_DIRECTORY_STACK,
} from "./powershell-aliases";
import {
  currentShellHost,
  resolveShell,
  type ResolvedShell,
  type ResolvedShellInterpreter,
  type ShellHost,
} from "./shell-interpreter";
import {
  parseShellLine,
  type ShellDialect,
  type ShellSegment,
  type ShellSimpleCommand,
  type ShellWord,
} from "./shell-parser";
import { analyzeArgvCommand, tokenizeCommand } from "./tokenize-command";

/** How a shell-mode line touches a path the jail has to vet. */
export type WorkspaceShellPathAccess = "read" | "write" | "cwd";

/** A path a shell-mode line redirects to/from or `cd`s into. */
export interface WorkspaceShellPath {
  /** Absolute path, resolved lexically against the workspace root (or an earlier `cd`). */
  path: string;
  /** What the line does with it. */
  access: WorkspaceShellPathAccess;
  /** The target as written in the line. */
  target: string;
}

/**
 * The shell policy's verdict on one command line — see
 * {@link checkShellCommand}.
 */
export interface WorkspaceShellCheck {
  /** Whether the line may run (path targets still get a symlink-aware recheck in `exec`). */
  allowed: boolean;
  /** Why it was refused. */
  reason?: WorkspaceShellRefusalReason;
  /** Model-facing refusal text: the cause, and how to fix the command. */
  message?: string;
  /** The executable the refusal is about, when there is one. */
  executable?: string;
  /** The redirection target or `cd` directory a `"path-escape"` refusal is about. */
  path?: string;
  /**
   * Commands that need a decision from `shell.onAsk` before the line may run.
   * When non-empty, `allowed` is `false` with reason `"approval-required"`;
   * the ops layer asks, and refuses with `"approval-denied"` if the answer is no.
   */
  asks: WorkspaceShellAsk[];
  /** The argv of every simple command checked, in order (wrapped commands included). */
  commands: string[][];
  /** Shell mode: every redirection target and `cd` directory, for the jail recheck. */
  paths: WorkspaceShellPath[];
}

/**
 * Programs and shell builtins that run a command or code the policy cannot
 * see (a script string, a file, a command read from input, another user).
 * With deny rules in force they would hide a denied command, so they are
 * refused unless the policy names them in `allow`.
 */
const OPAQUE_RUNNERS = new Set([
  // Shells and interpreters of command strings.
  "sh",
  "bash",
  "dash",
  "zsh",
  "ksh",
  "mksh",
  "ash",
  "yash",
  "posh",
  "fish",
  "csh",
  "tcsh",
  "busybox",
  "cmd",
  "powershell",
  "pwsh",
  "wsl",
  // Run a command as someone else, elsewhere, or out of the process group.
  "sudo",
  "doas",
  "su",
  "runuser",
  "pkexec",
  "runas",
  "chroot",
  "nsenter",
  "unshare",
  "setsid",
  "systemd-run",
  "start-stop-daemon",
  "daemonize",
  // Run commands built from input or on a schedule.
  "xargs",
  "parallel",
  "watch",
  "script",
  "expect",
  "at",
  "batch",
  "screen",
  "tmux",
  "stdbuf",
  "flock",
]);

/**
 * PowerShell cmdlets and aliases that run code or commands the policy cannot
 * see, or change what later names mean (lowercase).
 */
const POWERSHELL_OPAQUE = new Set([
  "iex",
  "invoke-expression",
  "invoke-command",
  "icm",
  "start-process",
  "saps",
  "start",
  "add-type",
  "set-alias",
  "sal",
  "new-alias",
  "nal",
  "invoke-item",
  "ii",
]);

/** POSIX shell builtins that evaluate code or change how later names resolve. */
const SHELL_OPAQUE_BUILTINS = new Set([
  "eval",
  ".",
  "source",
  "alias",
  "unalias",
  "hash",
  "enable",
  "trap",
  "let",
  "declare",
  "typeset",
  "local",
  "set",
  "shopt",
  "fc",
  "bind",
  "complete",
  "compgen",
  "compopt",
  "mapfile",
  "readarray",
]);

/** cmd.exe builtins that run commands or change the environment. */
const CMD_OPAQUE_BUILTINS = new Set(["call", "start", "set", "pushd", "popd"]);

/**
 * Shell builtins whose arguments bash may evaluate as arithmetic (array
 * subscripts such as `a[$(cmd)]`): their arguments must be literal and free
 * of `[`.
 */
const ARITHMETIC_SENSITIVE_BUILTINS = new Set([
  "test",
  "[",
  "printf",
  "read",
  "unset",
  "export",
  "readonly",
  "getopts",
  "wait",
  "kill",
  "shift",
  "return",
  "exit",
  "break",
  "continue",
  "ulimit",
]);

/**
 * Variables a shell-mode line may not assign: they change how the shell
 * parses, traces or resolves what follows (`CDPATH` would move `cd` out of
 * the jail's sight, `PS4` is expanded — command substitutions included —
 * on every traced line, `IFS` re-splits expansions).
 */
const SENSITIVE_VARIABLES = new Set([
  "CDPATH",
  "ENV",
  "BASH_ENV",
  "SHELLOPTS",
  "BASHOPTS",
  "IFS",
  "PS1",
  "PS2",
  "PS3",
  "PS4",
  "PROMPT_COMMAND",
  "BASH_XTRACEFD",
  "GLOBIGNORE",
  "EXECIGNORE",
  "BASH_LOADABLES_PATH",
]);

/** Redirection targets that are always fine even though they sit outside the jail. */
const DEVICE_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);

/** cmd.exe's null device. */
const CMD_DEVICE_TARGETS = new Set(["nul"]);

/** Deepest chain of wrappers (`env time nice …`) the policy unwraps. */
const MAX_WRAPPER_DEPTH = 8;

/** Most distinct directories a line may `cd` between. */
const MAX_CD_CANDIDATES = 32;

/** Longest command shown verbatim in a refusal before it is abbreviated. */
const MAX_SHOWN_COMMAND = 48;

/** The dialect `interpreter: "sh"` parses on this platform. */
export function shellDialect(): ShellDialect {
  return process.platform === "win32" ? "cmd" : "posix";
}

/**
 * Reduce an argv's first element to the basename the allow/deny policy is
 * keyed on. `"npm"` → `"npm"`; `"/usr/bin/node"` → `"node"`; `"node.exe"`
 * → `"node"` (the `.exe`/`.cmd`/`.bat`/`.com` Windows extension is
 * stripped). The cmd dialect splits Windows paths too.
 */
export function executableBasename(firstToken: string, dialect: ShellDialect = "posix"): string {
  const base =
    dialect === "cmd" || dialect === "powershell" || dialect === "powershell5"
      ? path.win32.basename(firstToken)
      : path.basename(firstToken);

  return base.replace(
    dialect === "powershell" || dialect === "powershell5"
      ? /\.(exe|cmd|bat|com|ps1)$/i
      : /\.(exe|cmd|bat|com)$/i,
    "",
  );
}

/** Show a command in a refusal, abbreviated at a word boundary when long. */
function show(source: string): string {
  const flat = source.replace(/\s+/g, " ").trim();

  if (flat.length <= MAX_SHOWN_COMMAND) {
    return `\`${flat}\``;
  }

  const cut = flat.lastIndexOf(" ", MAX_SHOWN_COMMAND);

  return `\`${flat.slice(0, cut > 0 ? cut : MAX_SHOWN_COMMAND)} …\``;
}

/** Compile `denyPatterns` once per check. */
interface CompiledPattern {
  source: WorkspaceCommandPattern;
  test(argv: string[], dialect: ShellDialect): boolean;
}

function compilePattern(pattern: WorkspaceCommandPattern): CompiledPattern {
  if (pattern instanceof RegExp) {
    const regex = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));

    return {
      source: pattern,
      test: (argv, dialect) =>
        regex.test([executableBasename(argv[0] ?? "", dialect), ...argv.slice(1)].join(" ")),
    };
  }

  const tokens = tokenizeCommand(pattern);

  if (tokens === null) {
    // Not representable as an argv: match it as text inside the joined argv.
    return {
      source: pattern,
      test: (argv, dialect) =>
        [executableBasename(argv[0] ?? "", dialect), ...argv.slice(1)].join(" ").includes(pattern),
    };
  }

  return {
    source: pattern,
    test: (argv, dialect) => {
      if (argv.length < tokens.length) {
        return false;
      }

      return tokens.every((token, index) => {
        const actual = argv[index] ?? "";

        return index === 0
          ? executableBasename(actual, dialect).toLowerCase() ===
              executableBasename(token, dialect).toLowerCase()
          : actual === token;
      });
    },
  };
}

/** Thrown inside the checker to stop at the first refusal. */
class Refusal extends Error {
  public constructor(
    public readonly reason: WorkspaceShellRefusalReason,
    message: string,
    public readonly executable?: string,
    public readonly refusedPath?: string,
  ) {
    super(message);
  }
}

/** Options a check takes beyond the policy and the line. */
export interface ShellCheckOptions {
  /** Patterns a host approved earlier with `remember`; they allow what would ask, never what is denied. */
  remembered?: readonly WorkspaceCommandPattern[];
  /** The host the `"auto"` interpreter is resolved against (tests inject one). */
  host?: ShellHost;
  /** The already-resolved shell, to skip resolving it again. */
  resolved?: ResolvedShell;
}

/** A compiled `shell.rules` entry. */
interface CompiledRule {
  rule: WorkspaceCommandRule;
  pattern: CompiledPattern;
}

/** Per-line checker state. */
class LineChecker {
  public readonly commands: string[][] = [];

  public readonly paths: WorkspaceShellPath[] = [];

  public readonly asks: WorkspaceShellAsk[] = [];

  private readonly deny: Set<string>;

  private readonly allow: string[];

  private readonly patterns: CompiledPattern[];

  private readonly rules: CompiledRule[];

  private readonly remembered: CompiledPattern[];

  private readonly hasCommandRules: boolean;

  /** Whether `shell.onAsk` is set: unmatched, unreadable and opaque commands ask. */
  public readonly askMode: boolean;

  public constructor(
    private readonly policy: WorkspacePolicy,
    private readonly shell: WorkspaceShellPolicy,
    private readonly line: string,
    private readonly dialect: ShellDialect,
    private readonly interpreter: ResolvedShellInterpreter,
    remembered: readonly WorkspaceCommandPattern[] = [],
  ) {
    this.deny = new Set((shell.deny ?? []).map((name) => name.toLowerCase()));
    this.allow = shell.allow ?? [];
    this.patterns = (shell.denyPatterns ?? []).map(compilePattern);
    this.rules = (shell.rules ?? []).map((rule) => ({ rule, pattern: compilePattern(rule.match) }));
    this.remembered = remembered.map(compilePattern);
    this.askMode = shell.onAsk !== undefined;
    this.hasCommandRules =
      this.deny.size > 0 ||
      this.patterns.length > 0 ||
      this.rules.length > 0 ||
      shell.allowCommand !== undefined;
  }

  /** Whether argument hooks (`denyPatterns` / `allowCommand`) need literal argv. */
  public get hasArgumentHooks(): boolean {
    return this.patterns.length > 0 || this.shell.allowCommand !== undefined;
  }

  private get shellMode(): boolean {
    return this.interpreter !== "none";
  }

  /** The last rule that matches `argv` (later rules win). */
  private matchRule(argv: string[]): WorkspaceCommandRule | undefined {
    for (let index = this.rules.length - 1; index >= 0; index--) {
      const compiled = this.rules[index] as CompiledRule;

      if (compiled.pattern.test(argv, this.dialect)) {
        return compiled.rule;
      }
    }

    return undefined;
  }

  private isRemembered(argv: string[]): boolean {
    return this.remembered.some((pattern) => pattern.test(argv, this.dialect));
  }

  /** Record a command that needs a decision (once per argv and reason). */
  public addAsk(
    argv: string[],
    reason: WorkspaceShellAsk["reason"],
    rule?: WorkspaceCommandRule,
  ): void {
    const key = `${reason}\u0000${argv.join("\u0000")}`;

    if (this.asks.some((ask) => `${ask.reason}\u0000${ask.argv.join("\u0000")}` === key)) {
      return;
    }

    this.asks.push({ argv: [...argv], reason, ...(rule !== undefined ? { rule } : {}) });
  }

  /** Refuse when the matching rule denies. */
  private assertNotDenied(argv: string[], rule: WorkspaceCommandRule | undefined): void {
    if (rule?.effect !== "deny") {
      return;
    }

    const explanation =
      rule.reason !== undefined && rule.reason.trim() !== "" ? ` ${rule.reason.trim()}` : "";

    throw new Refusal(
      "denied-pattern",
      `${show(argv.join(" "))} is denied by a workspace shell rule.${explanation}`,
      executableBasename(argv[0] ?? "", this.dialect),
    );
  }

  /**
   * Check the canonical form of a PowerShell alias (`Remove-Item -Recurse
   * -Force x` as `rm -rf x`): deny, `denyPatterns`, `allowCommand` and the
   * rules, but not the `allow` list (which names the spelling that was written).
   */
  public checkCanonical(argv: string[]): void {
    const key = executableBasename(argv[0] ?? "", this.dialect).toLowerCase();

    if (this.deny.has(key)) {
      throw new Refusal(
        "denied-executable",
        `\`${key}\` is denied by the workspace shell policy (in ${show(argv.join(" "))}).`,
        key,
      );
    }

    this.checkHooks(argv, true);

    const rule = this.matchRule(argv);

    this.assertNotDenied(argv, rule);

    if (rule?.effect === "ask" && !this.isRemembered(argv)) {
      this.addAsk(argv, "rule", rule);
    }
  }

  /** Refuse a denied executable (used for `cd` spellings). */
  public assertExecutableNotDenied(key: string, argv: string[]): void {
    if (this.deny.has(key)) {
      throw new Refusal(
        "denied-executable",
        `\`${key}\` is denied by the workspace shell policy (in ${show(argv.join(" "))}).`,
        key,
      );
    }
  }

  /** Run `denyPatterns` and `allowCommand` on one argv. */
  private checkHooks(argv: string[], nested: boolean): void {
    const shown = show(argv.join(" "));

    for (const pattern of this.patterns) {
      if (pattern.test(argv, this.dialect)) {
        throw new Refusal(
          "denied-pattern",
          `${shown} matches a command pattern the workspace shell policy denies.`,
          executableBasename(argv[0] ?? "", this.dialect),
        );
      }
    }

    const hook = this.shell.allowCommand;

    if (hook === undefined) {
      return;
    }

    let verdict: boolean | string;

    try {
      verdict = hook([...argv], { command: this.line, interpreter: this.interpreter, nested });
    } catch {
      verdict = false;
    }

    if (verdict === true) {
      return;
    }

    const explanation =
      typeof verdict === "string" && verdict.trim() !== "" ? ` ${verdict.trim()}` : "";

    throw new Refusal(
      "not-allowed",
      `${shown} was refused by the workspace shell policy.${explanation}`,
      executableBasename(argv[0] ?? "", this.dialect),
    );
  }

  /** Whether the policy names `executable` in a non-empty `allow` list. */
  private explicitlyAllowed(executable: string): boolean {
    return this.allow.includes(executable);
  }

  /** Refuse a command runner the policy cannot see into, unless explicitly allowed. */
  private checkOpaque(executable: string, argv: string[]): void {
    if (this.explicitlyAllowed(executable) || !this.hasCommandRules) {
      return;
    }

    throw new Refusal(
      "nested-command",
      `\`${executable}\` runs a command the workspace shell policy cannot inspect (in ${show(argv.join(" "))}). Run the inner command directly instead.`,
      executable,
    );
  }

  /**
   * Check one argv: `deny`, `allow`, `denyPatterns`, `allowCommand`, then
   * follow wrappers and `find -exec` to the command they run. `dynamic[i]`
   * says whether `argv[i]` is decided at run time (shell mode).
   */
  public checkArgv(argv: string[], dynamic: boolean[], depth: number): void {
    const first = argv[0] ?? "";
    const executable = executableBasename(first, this.dialect);
    const key = executable.toLowerCase();

    if (executable === "") {
      throw new Refusal("not-allowed", "The command has no executable name.");
    }

    if (dynamic[0] === true) {
      throw new Refusal(
        "unsupported-syntax",
        `The command name \`${first}\` is decided when the line runs, so the workspace shell policy cannot check it. Write the command name literally.`,
      );
    }

    if (this.deny.has(key)) {
      throw new Refusal(
        "denied-executable",
        `\`${executable}\` is denied by the workspace shell policy (in ${show(argv.join(" "))}).`,
        executable,
      );
    }

    if (this.allow.length > 0 && !this.allow.includes(executable)) {
      const listed = this.allow.slice(0, 20).join(", ");

      throw new Refusal(
        "not-allowed",
        `\`${executable}\` is not in the workspace shell allowlist. Allowed commands: ${listed}${this.allow.length > 20 ? ", …" : ""}.`,
        executable,
      );
    }

    this.checkHooks(argv, depth > 0);

    const rule = this.matchRule(argv);

    this.assertNotDenied(argv, rule);
    this.commands.push([...argv]);

    const remembered = this.isRemembered(argv);
    const approved = rule?.effect === "allow" || remembered || this.explicitlyAllowed(executable);

    if (
      OPAQUE_RUNNERS.has(key) ||
      (this.shellMode && this.dialect === "posix" && SHELL_OPAQUE_BUILTINS.has(key)) ||
      (this.shellMode && this.dialect === "cmd" && CMD_OPAQUE_BUILTINS.has(key)) ||
      (this.shellMode &&
        (this.dialect === "powershell" || this.dialect === "powershell5") &&
        POWERSHELL_OPAQUE.has(key))
    ) {
      if (approved) {
        return;
      }

      if (this.askMode || rule?.effect === "ask") {
        this.addAsk(argv, "nested", rule);

        return;
      }

      this.checkOpaque(executable, argv);

      return;
    }

    if (this.shellMode && this.dialect === "posix" && ARITHMETIC_SENSITIVE_BUILTINS.has(key)) {
      this.checkArithmeticSensitive(executable, argv, dynamic);
    }

    const ranges = this.unwrap(key, argv);

    // A command no rule or allow list covers asks — except a wrapper, which
    // asks through the command it runs.
    if (!approved && ranges === undefined) {
      if (rule?.effect === "ask") {
        this.addAsk(argv, "rule", rule);
      } else if (rule === undefined && this.askMode && this.allow.length === 0) {
        this.addAsk(argv, "rule");
      }
    } else if (!approved && rule?.effect === "ask") {
      this.addAsk(argv, "rule", rule);
    }

    if (ranges === undefined) {
      return;
    }

    if (ranges === null || depth >= MAX_WRAPPER_DEPTH) {
      if (this.askMode) {
        this.addAsk(argv, "nested", rule);

        return;
      }

      throw new Refusal(
        "nested-command",
        `\`${executable}\` is used with options the workspace shell policy cannot read (in ${show(argv.join(" "))}). Run the inner command directly instead.`,
        executable,
      );
    }

    for (const [start, end] of ranges) {
      this.checkArgv(argv.slice(start, end), dynamic.slice(start, end), depth + 1);
    }
  }

  /**
   * Builtins bash may evaluate arguments of as arithmetic (array subscripts
   * like `a[$(cmd)]` run the substitution): arguments must be literal, free
   * of `[`, and must not name a variable that changes how the shell runs.
   */
  private checkArithmeticSensitive(executable: string, argv: string[], dynamic: boolean[]): void {
    for (let index = 1; index < argv.length; index++) {
      const argument = argv[index] ?? "";

      if (dynamic[index] === true) {
        throw new Refusal(
          "unsupported-syntax",
          `\`${executable}\` arguments must be literal here (\`${argument}\` is not): bash may evaluate them as arithmetic.`,
          executable,
        );
      }

      if (argument.includes("[") && argument !== "[" && argument !== "]") {
        throw new Refusal(
          "unsupported-syntax",
          `\`${executable}\` arguments with \`[\` (array subscripts, evaluated as arithmetic) are not supported.`,
          executable,
        );
      }

      const name = argument.split("=")[0] ?? "";

      if (SENSITIVE_VARIABLES.has(name) || name.startsWith("BASH_FUNC_")) {
        throw new Refusal(
          "unsupported-syntax",
          `Changing \`${name}\` is not supported: it changes how the shell runs the commands that follow.`,
          executable,
        );
      }
    }
  }

  /**
   * The argv ranges a wrapper runs. `undefined` — not a wrapper (or one that
   * runs nothing, like a bare `env`); `null` — a wrapper whose options the
   * policy cannot read (refused).
   */
  private unwrap(key: string, argv: string[]): Array<[number, number]> | null | undefined {
    switch (key) {
      case "env":
        return suffixFrom(argv, unwrapEnv(argv));
      case "nice":
        return suffixFrom(argv, unwrapNice(argv));
      case "nohup":
        return suffixFrom(argv, unwrapSimple(argv, []));
      case "time":
        return suffixFrom(argv, unwrapSimple(argv, ["-p"]));
      case "timeout":
        return suffixFrom(argv, unwrapTimeout(argv));
      case "command":
        return argv.slice(1).some((arg) => arg === "-v" || arg === "-V")
          ? undefined
          : suffixFrom(argv, unwrapSimple(argv, ["-p"]));
      case "builtin":
        return suffixFrom(argv, unwrapSimple(argv, []));
      case "exec":
        return this.dialect === "posix" ? suffixFrom(argv, unwrapExec(argv)) : undefined;
      case "find":
        return unwrapFind(argv);
      default:
        return undefined;
    }
  }

  /** Check a `cd` (shell mode): literal, one operand, inside the jail from every possible cwd. */
  public checkCd(words: ShellWord[], cwds: string[]): string[] {
    const argv = words.map((word) => word.value);

    if (this.deny.has("cd")) {
      throw new Refusal("denied-executable", "`cd` is denied by the workspace shell policy.", "cd");
    }

    this.checkHooks(argv, false);
    this.commands.push(argv);

    const operands = words.slice(1);

    while (
      this.dialect === "posix" &&
      operands.length > 0 &&
      ["-P", "-L", "--"].includes(operands[0]?.value ?? "")
    ) {
      operands.shift();
    }

    const target = operands[0];

    if (operands.length !== 1 || target === undefined || target.value === "-" || target.dynamic) {
      throw new Refusal(
        "unsupported-syntax",
        "`cd` needs exactly one literal directory inside the workspace (no `-`, `~` or variables).",
        "cd",
      );
    }

    const next = new Set(cwds);

    for (const cwd of cwds) {
      const resolved = this.resolveTarget(cwd, target.value);

      this.assertInJail(resolved, target.value, "cd");
      this.paths.push({ path: resolved, access: "cwd", target: target.value });
      next.add(resolved);
    }

    if (next.size > MAX_CD_CANDIDATES) {
      throw new Refusal("unsupported-syntax", "The line changes directory too many times.", "cd");
    }

    return [...next];
  }

  /** Check a redirection target from every possible cwd. */
  public checkRedirectTarget(word: ShellWord, access: "read" | "write", cwds: string[]): void {
    if (
      (this.dialect === "powershell" || this.dialect === "powershell5") &&
      !word.quoted &&
      word.value.toLowerCase() === "$null"
    ) {
      return;
    }

    if (word.dynamic) {
      throw new Refusal(
        "unsupported-syntax",
        `The redirection target \`${word.raw}\` must be a literal path (no variables, globs or \`~\`).`,
      );
    }

    const value = word.value;

    if (
      (this.dialect === "posix" && DEVICE_TARGETS.has(value)) ||
      (this.dialect === "cmd" && CMD_DEVICE_TARGETS.has(value.toLowerCase()))
    ) {
      return;
    }

    for (const cwd of cwds) {
      const resolved = this.resolveTarget(cwd, value);

      this.assertInJail(resolved, value, "redirect");
      this.paths.push({ path: resolved, access, target: value });
    }
  }

  private resolveTarget(cwd: string, target: string): string {
    return path.resolve(cwd, target);
  }

  private assertInJail(resolved: string, target: string, kind: "cd" | "redirect"): void {
    if (isInsideJailLexically(this.policy, resolved)) {
      return;
    }

    throw new Refusal(
      "path-escape",
      kind === "cd"
        ? `\`cd ${target}\` leaves the workspace jail (or enters a denied path); commands must stay inside the workspace.`
        : `The redirection target \`${target}\` is outside the workspace jail or on a denied path.`,
      undefined,
      target,
    );
  }
}

/**
 * Turn a wrapper's "inner command starts at `start`" into a range; a
 * wrapper that runs nothing (`start === argv.length`) becomes `undefined`.
 */
function suffixFrom(
  argv: string[],
  start: number | null,
): Array<[number, number]> | null | undefined {
  if (start === null) {
    return null;
  }

  return start < argv.length ? [[start, argv.length]] : undefined;
}

/** `nohup` / `time` / `command` / `builtin`: skip the listed flags and `--`. */
function unwrapSimple(argv: string[], flags: string[]): number | null {
  let index = 1;

  while (index < argv.length) {
    const arg = argv[index] ?? "";

    if (arg === "--") {
      index++;

      break;
    }

    if (flags.includes(arg)) {
      index++;

      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      return null;
    }

    break;
  }

  return index;
}

/** `env [-i] [-u NAME] [NAME=value]… command…` */
function unwrapEnv(argv: string[]): number | null {
  let index = 1;

  while (index < argv.length) {
    const arg = argv[index] ?? "";

    if (arg === "-i" || arg === "-" || arg === "--ignore-environment") {
      index++;

      continue;
    }

    if (arg === "-u" || arg === "--unset") {
      index += 2;

      continue;
    }

    if (arg.startsWith("--unset=") || (arg.startsWith("-u") && arg.length > 2)) {
      index++;

      continue;
    }

    if (arg === "--") {
      index++;

      break;
    }

    if (arg.startsWith("-")) {
      return null;
    }

    break;
  }

  while (index < argv.length && /^[^=]+=/.test(argv[index] ?? "")) {
    index++;
  }

  return index;
}

/** `nice [-n N | -N | --adjustment=N] command…` */
function unwrapNice(argv: string[]): number | null {
  let index = 1;

  while (index < argv.length) {
    const arg = argv[index] ?? "";

    if (arg === "-n" || arg === "--adjustment") {
      index += 2;

      continue;
    }

    if (/^-n-?[0-9]+$/.test(arg) || /^--adjustment=-?[0-9]+$/.test(arg) || /^-[0-9]+$/.test(arg)) {
      index++;

      continue;
    }

    if (arg === "--") {
      index++;

      break;
    }

    if (arg.startsWith("-")) {
      return null;
    }

    break;
  }

  return index;
}

/** `timeout [options] DURATION command…` */
function unwrapTimeout(argv: string[]): number | null {
  let index = 1;

  while (index < argv.length) {
    const arg = argv[index] ?? "";

    if (arg === "-s" || arg === "--signal" || arg === "-k" || arg === "--kill-after") {
      index += 2;

      continue;
    }

    if (
      /^-[sk].+$/.test(arg) ||
      arg.startsWith("--signal=") ||
      arg.startsWith("--kill-after=") ||
      arg === "--preserve-status" ||
      arg === "--foreground" ||
      arg === "-v" ||
      arg === "--verbose"
    ) {
      index++;

      continue;
    }

    if (arg === "--") {
      index++;

      break;
    }

    if (arg.startsWith("-")) {
      return null;
    }

    break;
  }

  // The duration, then the command.
  if (index >= argv.length - 1) {
    return null;
  }

  return index + 1;
}

/** `exec [-cl] [-a name] command…` (bash). */
function unwrapExec(argv: string[]): number | null {
  let index = 1;

  while (index < argv.length) {
    const arg = argv[index] ?? "";

    if (arg === "-c" || arg === "-l" || arg === "-cl" || arg === "-lc") {
      index++;

      continue;
    }

    if (arg === "-a") {
      index += 2;

      continue;
    }

    if (arg === "--") {
      index++;

      break;
    }

    if (arg.startsWith("-")) {
      return null;
    }

    break;
  }

  return index;
}

/** The commands `find -exec / -execdir / -ok / -okdir … ;|+` runs. */
function unwrapFind(argv: string[]): Array<[number, number]> | null | undefined {
  const inner: Array<[number, number]> = [];

  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index] ?? "";

    if (arg !== "-exec" && arg !== "-execdir" && arg !== "-ok" && arg !== "-okdir") {
      continue;
    }

    const start = index + 1;
    let end = start;

    while (end < argv.length && argv[end] !== ";" && argv[end] !== "+") {
      end++;
    }

    if (end >= argv.length || end === start) {
      return null;
    }

    inner.push([start, end]);
    index = end;
  }

  return inner.length > 0 ? inner : undefined;
}

/** Build the argv-mode refusal for a line that is not a single argv. */
function argvModeRefusal(command: string): Refusal {
  const analysis = analyzeArgvCommand(command);

  if (analysis.ok) {
    // Not reached: callers only ask for a refusal of a line that failed.
    return new Refusal("metacharacter", "The command cannot run as a single argv.");
  }

  if (analysis.type === "empty") {
    return new Refusal("not-allowed", "The command is empty.");
  }

  if (analysis.type === "unbalanced-quotes") {
    return new Refusal(
      "unbalanced-quotes",
      `The command has an unbalanced \`${analysis.quote}\` quote. Close it, or quote the argument with the other kind of quote.`,
    );
  }

  const token = analysis.token;
  const suffix = " (run_shell executes a single command without a shell.)";
  const parsed = parseShellLine(command, "posix");
  const segments: ShellSegment[] = parsed.ok ? parsed.segments : [];
  const listOperator = token === "&&" || token === "||" || token === ";" || token === "\n";

  if (listOperator && segments.length >= 2) {
    const shownOperator = token === "\n" ? "A line break" : `\`${token}\``;
    const firstWords = (segments[0]?.source ?? "").trim().split(/\s+/);

    if (firstWords[0] === "cd") {
      const rest = segments.slice(1).map((segment) => show(segment.source));

      return new Refusal(
        "metacharacter",
        `${shownOperator} is not supported in argv mode, and \`cd\` does not carry over: every command starts in the workspace root. Run ${rest.join(", then ")} on its own, with paths relative to the root.${suffix}`,
      );
    }

    const steps = segments.map((segment) => show(segment.source));
    const joiner = token === "||" ? ", and if it fails, " : ", then ";

    return new Refusal(
      "metacharacter",
      `${shownOperator} is not supported in argv mode: run ${steps.join(joiner)}, as separate commands.${suffix}`,
    );
  }

  if (token === "&" && segments.length >= 1) {
    const steps = segments.map((segment) => show(segment.source));
    const run =
      steps.length === 1
        ? `run ${steps[0] ?? ""} without it`
        : `run ${steps.join(", then ")} as separate commands`;

    return new Refusal(
      "metacharacter",
      `\`&\` is not supported in argv mode: ${run}; start a long-running command with background: true.${suffix}`,
    );
  }

  if (token === "|") {
    const pipeline = command
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);

    return new Refusal(
      "metacharacter",
      `\`|\` (a pipe) is not supported in argv mode: run ${show(pipeline[0] ?? command)} on its own and read its output yourself.${suffix}`,
    );
  }

  if (token === ">" || token === ">>" || token === ">&") {
    return new Refusal(
      "metacharacter",
      `\`${token}\` (redirection) is not supported in argv mode: run the command without it and save the output with write_file if you need it.${suffix}`,
    );
  }

  if (token === "<" || token === "<<" || token === "<&") {
    return new Refusal(
      "metacharacter",
      `\`${token}\` (input redirection) is not supported in argv mode: pass the file path to the command as an argument.${suffix}`,
    );
  }

  if (token === "$(" || token === "`") {
    return new Refusal(
      "metacharacter",
      `Command substitution (${token === "$(" ? "`$(…)`" : "backticks"}) is not supported in argv mode: run the inner command first, then pass its output literally.${suffix}`,
    );
  }

  if (token === "$" || token === "${") {
    return new Refusal(
      "metacharacter",
      `\`$\` (variable expansion) is not supported in argv mode: write the value literally, or put the \`$\` inside quotes to pass it as text.${suffix}`,
    );
  }

  if (token === "(" || token === ")") {
    return new Refusal(
      "metacharacter",
      `\`${token}\` is not supported in argv mode: put it inside quotes to pass it as text.${suffix}`,
    );
  }

  return new Refusal(
    "metacharacter",
    `\`${token === "\n" ? "\\n" : token}\` is not supported in argv mode: run one command per call, and quote any argument that contains it.${suffix}`,
  );
}

/** Check a shell-mode line. */
function checkShellLine(
  checker: LineChecker,
  policy: WorkspacePolicy,
  command: string,
  dialect: ShellDialect,
): void {
  if (/^[-+]/.test(command)) {
    throw new Refusal("unsupported-syntax", "A command line may not start with `-` or `+`.");
  }

  const parsed = parseShellLine(command, dialect);

  if (!parsed.ok) {
    if (checker.askMode) {
      checker.addAsk([command], "unparsed");

      return;
    }

    throw new Refusal(
      parsed.reason,
      `${parsed.message} The workspace shell policy only runs lines it can check.`,
    );
  }

  if (parsed.background) {
    throw new Refusal(
      "unsupported-syntax",
      "`&` (run in the background) is not supported in a command line: start a long-running command with background: true instead.",
    );
  }

  let cwds = [path.resolve(policy.cwd)];

  for (const simple of parsed.commands) {
    cwds = checkSimpleCommand(checker, simple, cwds, dialect);
  }
}

/** Check one parsed simple command; returns the possible working directories after it. */
function checkSimpleCommand(
  checker: LineChecker,
  simple: ShellSimpleCommand,
  cwds: string[],
  dialect: ShellDialect,
): string[] {
  for (const assignment of simple.assignments) {
    const name = assignment.assignmentName ?? "";

    if (SENSITIVE_VARIABLES.has(name) || name.startsWith("BASH_FUNC_")) {
      throw new Refusal(
        "unsupported-syntax",
        `Assigning \`${name}\` is not supported: it changes how the shell runs the commands that follow.`,
      );
    }
  }

  for (const redirect of simple.redirects) {
    if (redirect.type === "read" || redirect.type === "write") {
      checker.checkRedirectTarget(redirect.target, redirect.type, cwds);
    }
  }

  const first = simple.words[0];

  if (first === undefined) {
    return cwds;
  }

  const executable = first.dynamic ? "" : executableBasename(first.value, dialect).toLowerCase();
  const powershell = dialect === "powershell" || dialect === "powershell5";

  if (executable === "cd" || (powershell && POWERSHELL_CD_NAMES.has(executable))) {
    // A `cd` the policy cannot follow would let later targets escape the jail:
    // it is refused outright, never turned into an ask.
    checker.assertExecutableNotDenied(
      executable,
      simple.words.map((word) => word.value),
    );

    if (powershell) {
      const words = normalizePowerShellCd(simple.words);

      if (words === null) {
        throw new Refusal(
          "unsupported-syntax",
          "`Set-Location` is supported with one directory (`-Path` / `-LiteralPath` or positional) only.",
          "cd",
        );
      }

      return checker.checkCd(words, cwds);
    }

    return checker.checkCd(simple.words, cwds);
  }

  try {
    if (!first.dynamic && first.value.includes("=")) {
      throw new Refusal(
        "unsupported-syntax",
        `\`${first.raw}\` is not a plain command name or \`NAME=value\` assignment.`,
      );
    }

    if (/^[-+]/.test(first.value)) {
      throw new Refusal("unsupported-syntax", `\`${first.raw}\` is not a command name.`);
    }

    if (checker.hasArgumentHooks) {
      const dynamic = simple.words.find((word) => word.dynamic);

      if (dynamic !== undefined) {
        throw new Refusal(
          "unsupported-syntax",
          `\`${dynamic.raw}\` is decided when the line runs, so it cannot be checked against the workspace shell policy's command rules. Write the value literally (quote globs).`,
        );
      }
    }

    if (
      (dialect === "posix" && (executable === "pushd" || executable === "popd")) ||
      (powershell && POWERSHELL_DIRECTORY_STACK.has(executable))
    ) {
      throw new Refusal(
        "unsupported-syntax",
        `\`${executable}\` is not supported; use \`${powershell ? "Set-Location" : "cd"}\`.`,
      );
    }

    const argv = simple.words.map((word) => (word.dynamic ? word.raw : word.value));

    checker.checkArgv(
      argv,
      simple.words.map((word) => word.dynamic),
      0,
    );

    if (powershell) {
      const canonical = canonicalPowerShellArgv(argv);

      if (canonical !== undefined && canonical.join("\u0000") !== argv.join("\u0000")) {
        checker.checkCanonical(canonical);
      }
    }
  } catch (error) {
    // A command the policy cannot read is put to the host instead of refused.
    if (error instanceof Refusal && error.reason === "unsupported-syntax" && checker.askMode) {
      checker.addAsk(
        simple.words.map((word) => (word.dynamic ? word.raw : word.value)),
        "unparsed",
      );

      return cwds;
    }

    throw error;
  }

  return cwds;
}

/**
 * The shell policy's verdict on a command line, without touching the
 * filesystem.
 *
 * - **argv mode** (`interpreter: "none"`, the default): the line must
 *   tokenize into one argv; otherwise it is refused with a
 *   `"metacharacter"` / `"unbalanced-quotes"` reason and a message that
 *   names the operator and suggests the split.
 * - **shell mode** (`interpreter: "sh"`): the line is parsed and every
 *   simple command — inside `;`, `&&`, `||`, pipes, subshells, `$( )`,
 *   backticks and here-documents — is checked; redirection targets and `cd`
 *   directories must stay in the jail (checked lexically here; `exec`
 *   re-checks them with symlinks resolved).
 *
 * Every argv goes through `deny` (case-insensitive, wins), `allow`
 * (exhaustive when non-empty), `denyPatterns` and `allowCommand`.
 * Wrappers (`env`, `time`, `timeout`, `nice`, `nohup`, `command`,
 * `builtin`, `exec`) and `find -exec` are followed to the command they run.
 * A runner the policy cannot see into (`bash -c`, `eval`, `xargs`, `sudo`,
 * …) is refused while the policy has deny rules, unless `allow` names it.
 *
 * @example
 * checkShellCommand({ cwd, shell: { allow: ["git"] } }, "git add -A && git commit -m wip");
 * // { allowed: false, reason: "metacharacter", message: "`&&` is not supported in argv mode: run `git add -A`, then `git commit -m wip`, …" }
 */
export function checkShellCommand(
  policy: WorkspacePolicy,
  command: string,
  options?: ShellCheckOptions,
): WorkspaceShellCheck {
  const resolved =
    options?.resolved ?? resolveShell(policy.shell, options?.host ?? currentShellHost());

  return runCheck(policy, command, resolved.interpreter, resolved.dialect, options?.remembered);
}

/**
 * {@link checkShellCommand} with the shell-mode dialect chosen explicitly
 * instead of from the interpreter (used to test the cmd.exe and PowerShell
 * rules anywhere). Argv mode ignores `dialect`.
 */
export function checkShellCommandInDialect(
  policy: WorkspacePolicy,
  command: string,
  dialect: ShellDialect,
  options?: ShellCheckOptions,
): WorkspaceShellCheck {
  const resolved =
    options?.resolved ?? resolveShell(policy.shell, options?.host ?? currentShellHost());

  return runCheck(policy, command, resolved.interpreter, dialect, options?.remembered);
}

function runCheck(
  policy: WorkspacePolicy,
  command: string,
  interpreter: ResolvedShellInterpreter,
  dialect: ShellDialect,
  remembered?: readonly WorkspaceCommandPattern[],
): WorkspaceShellCheck {
  const shell = policy.shell;

  if (!shell) {
    return {
      allowed: false,
      reason: "not-allowed",
      message: "The workspace has no shell policy, so no command may run.",
      asks: [],
      commands: [],
      paths: [],
    };
  }

  const shellMode = interpreter !== "none";
  const checker = new LineChecker(
    policy,
    shell,
    command,
    shellMode ? dialect : "posix",
    interpreter,
    remembered,
  );

  try {
    if (command.trim() === "") {
      throw new Refusal("not-allowed", "The command is empty.");
    }

    if (shellMode) {
      checkShellLine(checker, policy, command, dialect);
    } else {
      const argv = tokenizeCommand(command);

      if (argv === null) {
        throw argvModeRefusal(command);
      }

      checker.checkArgv(
        argv,
        argv.map(() => false),
        0,
      );
    }

    if (checker.asks.length > 0) {
      const first = checker.asks[0] as WorkspaceShellAsk;
      const shown = show(first.argv.join(" "));
      const why = first.rule?.reason !== undefined ? ` ${first.rule.reason}` : "";

      return {
        allowed: false,
        reason: "approval-required",
        message: `${shown} needs approval, and the workspace shell policy has no approval handler (shell.onAsk).${why}`,
        asks: checker.asks,
        commands: checker.commands,
        paths: checker.paths,
      };
    }

    return { allowed: true, asks: [], commands: checker.commands, paths: checker.paths };
  } catch (error) {
    if (!(error instanceof Refusal)) {
      throw error;
    }

    return {
      allowed: false,
      reason: error.reason,
      message: error.message,
      ...(error.executable !== undefined ? { executable: error.executable } : {}),
      ...(error.refusedPath !== undefined ? { path: error.refusedPath } : {}),
      asks: [],
      commands: checker.commands,
      paths: checker.paths,
    };
  }
}

/**
 * The simple commands a line would run (pipeline members, `&&` / `||` / `;`
 * parts, subshells and substitutions included), without checking anything.
 * A line the parser cannot read with confidence comes back with `opaque`
 * set to the reason and no commands.
 *
 * The line is read with the policy's shell dialect when its `interpreter`
 * is a shell, and with the platform's default shell otherwise.
 *
 * @example
 * classifyShellCommand("a | b"); // { commands: [["a"], ["b"]] }
 */
export function classifyShellCommand(
  command: string,
  policy?: Pick<WorkspacePolicy, "shell">,
  host?: ShellHost,
): WorkspaceShellClassification {
  const resolved = resolveShell(policy?.shell, host ?? currentShellHost());
  const dialect = resolved.interpreter === "none" ? shellDialect() : resolved.dialect;
  const parsed = parseShellLine(command, dialect);

  if (!parsed.ok) {
    return { commands: [], opaque: parsed.message };
  }

  return {
    commands: parsed.commands
      .filter((simple) => simple.words.length > 0)
      .map((simple) => simple.words.map((word) => (word.dynamic ? word.raw : word.value))),
  };
}
