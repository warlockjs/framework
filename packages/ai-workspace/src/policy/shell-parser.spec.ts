import { describe, expect, it } from "vitest";
import { parseShellLine, type ShellParseResult } from "./shell-parser";

/** The argv (word values) of every simple command a line runs. */
function argvs(line: string): string[][] {
  const parsed = parseShellLine(line, "posix");

  if (!parsed.ok) {
    throw new Error(`expected "${line}" to parse: ${parsed.message}`);
  }

  return parsed.commands
    .filter((command) => command.words.length > 0)
    .map((command) => command.words.map((word) => word.value));
}

/** Assert a line is refused, returning the refusal. */
function refused(line: string, dialect: "posix" | "cmd" = "posix") {
  const parsed: ShellParseResult = parseShellLine(line, dialect);

  if (parsed.ok) {
    throw new Error(`expected "${line}" to be refused`);
  }

  return parsed;
}

describe("parseShellLine (posix)", () => {
  it("splits lists on ;, &&, || and newlines and keeps the top-level segments", () => {
    const parsed = parseShellLine(
      "git add -A && git commit -m 'wip: x'; ls\nnpm test || true",
      "posix",
    );

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(parsed.commands.map((command) => command.words.map((word) => word.value))).toEqual([
      ["git", "add", "-A"],
      ["git", "commit", "-m", "wip: x"],
      ["ls"],
      ["npm", "test"],
      ["true"],
    ]);
    expect(parsed.segments.map((segment) => segment.operator)).toEqual([
      "&&",
      ";",
      "\n",
      "||",
      undefined,
    ]);
    expect(parsed.background).toBe(false);
  });

  it("finds every command of a pipeline", () => {
    expect(argvs("npm test 2>&1 | grep -i fail | wc -l")).toEqual([
      ["npm", "test"],
      ["grep", "-i", "fail"],
      ["wc", "-l"],
    ]);
  });

  it("parses command substitutions recursively, inner commands first", () => {
    expect(argvs("echo $(rm -rf /tmp/x) done")).toEqual([
      ["rm", "-rf", "/tmp/x"],
      ["echo", "$(rm -rf /tmp/x)", "done"],
    ]);
    expect(argvs("echo `rm -rf /tmp/x`")).toEqual([
      ["rm", "-rf", "/tmp/x"],
      ["echo", "`rm -rf /tmp/x`"],
    ]);
    expect(argvs('echo "a $(id -u) b `whoami`"')).toEqual([
      ["id", "-u"],
      ["whoami"],
      ["echo", "a $(id -u) b `whoami`"],
    ]);
    expect(argvs("echo $(echo $(uname))")).toEqual([
      ["uname"],
      ["echo", "$(uname)"],
      ["echo", "$(echo $(uname))"],
    ]);
  });

  it("parses nested backticks written with escaped backticks", () => {
    expect(argvs("echo `echo \\`uname\\``")).toEqual([
      ["uname"],
      ["echo", "`uname`"],
      ["echo", "`echo \\`uname\\``"],
    ]);
  });

  it("parses subshells and the redirections after them", () => {
    const parsed = parseShellLine("(cd sub && npm test) > out.txt 2>&1", "posix");

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(parsed.commands.map((command) => command.words.map((word) => word.value))).toEqual([
      ["cd", "sub"],
      ["npm", "test"],
      [],
    ]);
    expect(
      parsed.commands[2]?.redirects.map((redirect) => [
        redirect.op,
        redirect.target.value,
        redirect.type,
      ]),
    ).toEqual([
      [">", "out.txt", "write"],
      [">&", "1", "dup"],
    ]);
  });

  it("separates NAME=value assignments from the command", () => {
    const parsed = parseShellLine("FOO=1 BAR=$(id) rm -rf /tmp/x", "posix");

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const command = parsed.commands.at(-1);

    expect(command?.assignments.map((word) => word.assignmentName)).toEqual(["FOO", "BAR"]);
    expect(command?.words.map((word) => word.value)).toEqual(["rm", "-rf", "/tmp/x"]);
    expect(parsed.commands[0]?.words.map((word) => word.value)).toEqual(["id"]);
  });

  it("removes quotes and escapes, and marks words decided at run time", () => {
    const parsed = parseShellLine(`r''m \\-rf "a b" $HOME *.ts ~/x '*'`, "posix");

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const words = parsed.commands[0]?.words ?? [];

    expect(words.map((word) => word.value)).toEqual([
      "rm",
      "-rf",
      "a b",
      "$HOME",
      "*.ts",
      "~/x",
      "*",
    ]);
    expect(words.map((word) => word.dynamic)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("reads redirections, including file descriptors and duplications", () => {
    const parsed = parseShellLine(
      "node a.js < in.txt >> log.txt 2>/dev/null 3<>rw.txt >&2",
      "posix",
    );

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(
      parsed.commands[0]?.redirects.map((redirect) => [
        redirect.fd ?? null,
        redirect.op,
        redirect.target.value,
        redirect.type,
      ]),
    ).toEqual([
      [null, "<", "in.txt", "read"],
      [null, ">>", "log.txt", "write"],
      [2, ">", "/dev/null", "write"],
      [3, "<>", "rw.txt", "write"],
      [null, ">&", "2", "dup"],
    ]);
  });

  it("reads here-documents and parses substitutions in an unquoted-delimiter body", () => {
    expect(argvs("cat <<EOF\nhello $(whoami) `id`\nEOF\necho done")).toEqual([
      ["cat"],
      ["whoami"],
      ["id"],
      ["echo", "done"],
    ]);
    // A quoted delimiter keeps the body literal.
    expect(argvs("cat <<'EOF'\nhello $(whoami)\nEOF")).toEqual([["cat"]]);
    // `<<-` strips leading tabs from the body and the delimiter line.
    expect(argvs("cat <<-END\n\t$(id)\n\tEND\nls")).toEqual([["cat"], ["id"], ["ls"]]);
  });

  it("skips comments", () => {
    expect(argvs("ls # && rm -rf /\necho ok")).toEqual([["ls"], ["echo", "ok"]]);
  });

  it("joins backslash-newline continuations", () => {
    expect(argvs("npm \\\n  test")).toEqual([["npm", "test"]]);
  });

  it("flags a backgrounding &", () => {
    const parsed = parseShellLine("npm run dev & echo started", "posix");

    expect(parsed.ok && parsed.background).toBe(true);
  });

  it("allows a lone {} (find -exec) and simple ${…} expansions", () => {
    expect(argvs("find . -name '*.ts' -exec wc -l {} \\;")).toEqual([
      ["find", ".", "-name", "*.ts", "-exec", "wc", "-l", "{}", ";"],
    ]);
    expect(argvs("echo ${HOME} ${#PATH} ${X:-default} ${F%.ts}")).toEqual([
      ["echo", "${HOME}", "${#PATH}", "${X:-default}", "${F%.ts}"],
    ]);
  });

  it.each([
    ["if true; then ls; fi", /compound command/],
    ["while true; do ls; done", /compound command/],
    ["case x in a) ls;; esac", /compound command/],
    ["{ ls; }", /brace/],
    ["echo {a,b}", /brace/],
    ["f() { rm; }", /subshell/],
    ["echo $((1 + 2))", /arithmetic/],
    ["((x = 1))", /arithmetic/],
    ["echo $[1+2]", /arithmetic/],
    ["echo ${x:0:2}", /parameter expansion/],
    ["echo ${!name}", /parameter expansion/],
    ["echo ${x@P}", /parameter expansion/],
    ["echo ${x:-$(id)}", /parameter expansion/],
    ["echo $'\\x41'", /quoting/],
    ['echo $"hi"', /quoting/],
    ["cat <<< hi", /here-string/],
    ["diff <(ls a) <(ls b)", /Process substitution/],
    ["echo hi &> out", /&>/],
    ["echo hi >&out", /not portable/],
    ["ls |& cat", /\|&/],
    ["ls &&", /no command follows/],
    ["ls | ", /no command follows/],
    ["&& ls", /empty command/],
    ["ls ;; ls", /;;/],
    ["cat <<EOF\nnever closed", /never terminated/],
    ["echo $(cat <<EOF\nx\nEOF\n)", /Here-documents inside/],
    ["echo ok\r", /Carriage return/],
    ["[[ -f x ]]", /compound command/],
    ["! ls", /compound command/],
    ["echo a)b", /Unexpected/],
  ])("refuses %j", (line, message) => {
    const result = refused(line);

    expect(result.reason).toBe("unsupported-syntax");
    expect(result.message).toMatch(message);
  });

  it.each([["echo 'open"], ['echo "open'], ["echo $(ls"], ["echo `ls"], ["echo ${HOME"], ["(ls"]])(
    "reports %j as unbalanced",
    (line) => {
      expect(refused(line).reason).toBe("unbalanced-quotes");
    },
  );

  it("refuses nesting deeper than its limit", () => {
    const deep = `${"$(".repeat(20)}ls${")".repeat(20)}`;

    expect(refused(`echo ${deep}`).message).toMatch(/too deeply/);
  });
});

describe("parseShellLine (cmd)", () => {
  it("splits on &&, ||, & and | and reads simple redirections", () => {
    const parsed = parseShellLine(
      'npm test && node "C:\\tools\\x.js" > out.txt 2>&1 | more & dir',
      "cmd",
    );

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(parsed.commands.map((command) => command.words.map((word) => word.value))).toEqual([
      ["npm", "test"],
      ["node", "C:\\tools\\x.js"],
      ["more"],
      ["dir"],
    ]);
    expect(
      parsed.commands[1]?.redirects.map((redirect) => [redirect.op, redirect.target.value]),
    ).toEqual([
      [">", "out.txt"],
      [">&", "1"],
    ]);
    // `&` is sequential in cmd.exe, not a background job.
    expect(parsed.background).toBe(false);
  });

  it.each([
    ["echo %PATH%", /%/],
    ['echo "%PATH%"', /%/],
    ['echo "!x!"', /%` and `!`/],
    ["echo ^&", /\^/],
    ["(dir)", /\(/],
    ["dir; del x", /;/],
    ["dir, x", /,/],
    ["if exist x del x", /compound command/],
    ["for %i in (*) do del %i", /compound command/],
    ["@echo off", /command name/],
    ["npm/../x test", /command name/],
    ["echo a\nb", /Line breaks/],
    ['node "a\\"b"', /backslash/],
    ["npm test &&", /no command follows/],
  ])("refuses %j", (line, message) => {
    const result = refused(line, "cmd");

    expect(result.message).toMatch(message);
  });

  it("reports an unclosed quote as unbalanced", () => {
    expect(refused('echo "open', "cmd").reason).toBe("unbalanced-quotes");
  });
});
