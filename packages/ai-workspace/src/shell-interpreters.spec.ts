import path from "node:path";
import { describe, expect, it } from "vitest";
import { planSpawn } from "./backends/local";
import { resolveShell, type ShellHost } from "./policy/shell-interpreter";
import { canonicalPowerShellArgv } from "./policy/powershell-aliases";
import { checkShellCommand, checkShellCommandInDialect } from "./policy/shell-check";
import { parseShellLine } from "./policy/shell-parser";
import { quotePattern } from "./tools/run-tests";
import { makeRunShellTool } from "./tools/run-shell";
import { workspace } from "./workspace";
import type { WorkspacePolicy } from "./contracts";

const cwd = "C:\\work\\app";
const posixCwd = "/srv/jail";

function host(platform: NodeJS.Platform, files: string[]): ShellHost {
  const pathEnv = platform === "win32" ? "C:\\tools;C:\\Git\\cmd" : "/usr/bin:/bin";

  return { platform, pathEnv, isExecutable: (file) => files.includes(file) };
}

function ps(shell: WorkspacePolicy["shell"] = {}, base = posixCwd): WorkspacePolicy {
  return { cwd: base, shell: { interpreter: "powershell", ...shell } };
}

function check(policy: WorkspacePolicy, line: string) {
  return checkShellCommandInDialect(policy, line, "powershell");
}

describe("resolveShell", () => {
  it("keeps none and maps sh to cmd on Windows", () => {
    expect(resolveShell(undefined).interpreter).toBe("none");
    expect(resolveShell({ interpreter: "sh" }, host("win32", [])).dialect).toBe("cmd");
    expect(resolveShell({ interpreter: "sh" }, host("linux", [])).dialect).toBe("posix");
  });

  it("auto picks bash then sh on POSIX", () => {
    expect(resolveShell({ interpreter: "auto" }, host("linux", ["/usr/bin/bash"]))).toMatchObject({
      interpreter: "bash",
      file: "/usr/bin/bash",
    });
    expect(resolveShell({ interpreter: "auto" }, host("linux", [])).interpreter).toBe("sh");
  });

  it("auto prefers pwsh, then PowerShell, then Git Bash, then cmd on Windows", () => {
    const pwsh = "C:\\tools\\pwsh.exe";
    const windowsPowerShell = "C:\\tools\\powershell.exe";
    const git = "C:\\Git\\cmd\\git.exe";
    const gitBash = "C:\\Git\\bin\\bash.exe";

    expect(
      resolveShell({ interpreter: "auto" }, host("win32", [pwsh, windowsPowerShell])),
    ).toMatchObject({
      interpreter: "powershell",
      file: pwsh,
      label: "PowerShell 7 (pwsh)",
    });
    expect(resolveShell({ interpreter: "auto" }, host("win32", [windowsPowerShell]))).toMatchObject({
      interpreter: "powershell",
      dialect: "powershell5",
      edition: "desktop",
      version: "5.1",
      label: "Windows PowerShell 5.1 (powershell)",
    });
    expect(resolveShell({ interpreter: "auto" }, host("win32", [pwsh]))).toMatchObject({
      dialect: "powershell",
      edition: "core",
    });
    expect(resolveShell({ interpreter: "auto" }, host("win32", [git, gitBash]))).toMatchObject({
      interpreter: "bash",
      file: gitBash,
    });
    // Git Bash wins over Windows PowerShell 5.1.
    expect(
      resolveShell({ interpreter: "auto" }, host("win32", [windowsPowerShell, git, gitBash])),
    ).toMatchObject({ interpreter: "bash", file: gitBash });
    expect(
      resolveShell(
        { interpreter: "auto" },
        { ...host("win32", [pwsh]), powershellVersion: () => "7.4.6" },
      ).version,
    ).toBe("7.4.6");
    expect(resolveShell({ interpreter: "auto" }, host("win32", [])).interpreter).toBe("cmd");
  });

  it("uses interpreterPath over the PATH lookup", () => {
    expect(
      resolveShell(
        { interpreter: "powershell", interpreterPath: "D:\\ps\\pwsh.exe" },
        host("win32", []),
      ),
    ).toMatchObject({ interpreter: "powershell", file: "D:\\ps\\pwsh.exe" });
  });
});

describe("planSpawn per interpreter", () => {
  it("spawns PowerShell with the non-interactive flags", () => {
    expect(planSpawn("Get-Date", "powershell", "pwsh")).toMatchObject({
      file: "pwsh",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Date"],
    });
  });

  it("spawns bash and sh with -c, and cmd with its switches", () => {
    expect(planSpawn("ls", "bash", "/usr/bin/bash")).toMatchObject({
      file: "/usr/bin/bash",
      args: ["-c", "ls"],
    });
    expect(planSpawn("ls", "sh", undefined, "linux")).toMatchObject({
      file: "/bin/sh",
      args: ["-c", "ls"],
    });
    expect(planSpawn("dir", "cmd", "cmd.exe")).toMatchObject({
      args: ["/d", "/v:off", "/s", "/c", '"dir"'],
    });
  });
});

describe("bash dialect", () => {
  const policy: WorkspacePolicy = { cwd: posixCwd, shell: { interpreter: "bash", deny: ["rm"] } };

  it("runs globs in quotes, escaped quotes, % and !", () => {
    expect(checkShellCommand(policy, "git log -- '*.ts'").allowed).toBe(true);
    expect(checkShellCommand(policy, 'echo "a\\"b"').allowed).toBe(true);
    expect(checkShellCommand(policy, "echo 100% done!").allowed).toBe(true);
  });

  it("still finds a denied command", () => {
    expect(checkShellCommand(policy, "echo hi && rm x").reason).toBe("denied-executable");
  });
});

describe("PowerShell dialect", () => {
  it("parses pipelines, ;, && and ||", () => {
    const parsed = parseShellLine(
      "Get-ChildItem -Recurse -Filter *.ts | Select-Object -First 3; git status && git log || echo no",
      "powershell",
    );

    expect(parsed.ok && parsed.commands.map((c) => c.words.map((w) => w.value))).toEqual([
      ["Get-ChildItem", "-Recurse", "-Filter", "*.ts"],
      ["Select-Object", "-First", "3"],
      ["git", "status"],
      ["git", "log"],
      ["echo", "no"],
    ]);
  });

  it("runs the pipeline under a deny list", () => {
    const policy = ps({ deny: ["Remove-Item"] });

    expect(
      check(policy, "Get-ChildItem -Recurse -Filter *.ts | Select-Object -First 3").allowed,
    ).toBe(true);
  });

  it("reads quotes, the call operator and subexpressions", () => {
    const parsed = parseShellLine(
      "& 'C:\\Program Files\\x\\tool.exe' \"a b\" 'it''s' $(Get-Date)",
      "powershell",
    );

    expect(parsed.ok && parsed.commands.map((c) => c.words.map((w) => w.value))).toEqual([
      ["Get-Date"],
      ["C:\\Program Files\\x\\tool.exe", "a b", "it's", "$(Get-Date)"],
    ]);
  });

  it("checks commands inside a subexpression", () => {
    expect(check(ps({ deny: ["rm"] }), "echo $(rm x)").reason).toBe("denied-executable");
  });

  it.each([
    ["script block", "Get-ChildItem | ForEach-Object { $_.Name }"],
    ["array", "Write-Output @(1,2)"],
    ["splat", "git @args"],
    ["here-string", "Write-Output @'\nx\n'@"],
    ["stop parsing", "icacls --% x"],
    ["compound keyword", "foreach ($x in 1) { }"],
    ["dot sourcing", ". .\\profile.ps1"],
    ["background", "ping localhost &"],
    ["input redirect", "git apply < patch"],
    ["comment", "ls # hi"],
    ["grouping", "(Get-Date)"],
    ["comma", "Remove-Item a,b"],
    ["push-location", "Push-Location x"],
    ["pushd", "pushd x"],
    ["variable command", "$cmd x"],
  ])("refuses %s as unsupported syntax", (_name, line) => {
    expect(check(ps(), line)).toMatchObject({ allowed: false, reason: "unsupported-syntax" });
  });

  it("refuses an unclosed quote", () => {
    expect(check(ps(), "echo 'x").reason).toBe("unbalanced-quotes");
  });

  it("treats typographic quotes as quotes", () => {
    const parsed = parseShellLine("echo \u2018a b\u2019", "powershell");

    expect(parsed.ok && parsed.commands[0]?.words[1]?.value).toBe("a b");
  });

  it("matches rm-style denials through the alias table", () => {
    const policy = ps({ denyPatterns: ["rm -rf"] });

    for (const line of [
      "Remove-Item -Recurse -Force x",
      "ri -r -fo x",
      "rm -Recurse -Force x",
      "del -Force -Recurse x",
      "rd -Path x -Recurse -Force",
      "Remove-Item x -rec -for",
      "rmdir x -Recurse:true -Force",
    ]) {
      expect(check(policy, line), line).toMatchObject({ allowed: false, reason: "denied-pattern" });
    }

    expect(check(policy, "Remove-Item x").allowed).toBe(true);
    expect(check(policy, "Remove-Item -Recurse x").allowed).toBe(true);
  });

  it("also checks the written spelling", () => {
    expect(check(ps({ deny: ["Remove-Item"] }), "Remove-Item x").reason).toBe("denied-executable");
    expect(check(ps({ deny: ["rm"] }), "Remove-Item x").reason).toBe("denied-executable");
  });

  it("builds canonical argv for the other aliases", () => {
    expect(canonicalPowerShellArgv(["Copy-Item", "-Recurse", "a", "b"])).toEqual([
      "cp",
      "-r",
      "a",
      "b",
    ]);
    expect(canonicalPowerShellArgv(["mi", "-Path", "a", "-Destination", "b"])).toEqual([
      "mv",
      "a",
      "b",
    ]);
    expect(canonicalPowerShellArgv(["gci", "-Recurse", "-Force"])).toEqual(["ls", "-Ra"]);
    expect(canonicalPowerShellArgv(["Get-Content", "-Path", "f"])).toEqual(["cat", "f"]);
    expect(
      canonicalPowerShellArgv(["iwr", "-Uri", "http://x", "-OutFile", "o", "-Method", "Post"]),
    ).toEqual(["curl", "-o", "o", "-X", "Post", "http://x"]);
    expect(canonicalPowerShellArgv(["Stop-Process", "-Id", "5", "-Force"])).toEqual([
      "kill",
      "-9",
      "5",
    ]);
    expect(canonicalPowerShellArgv(["git", "status"])).toBeUndefined();
  });

  it.each([
    "iex 'rm x'",
    'Invoke-Expression "x"',
    "Invoke-Command -ScriptBlock x",
    "Start-Process x",
    "Add-Type x",
    "Set-Alias a b",
    "powershell -EncodedCommand AAAA",
    "pwsh -Command x",
  ])("refuses %s as a nested command under deny rules", (line) => {
    expect(check(ps({ deny: ["format-volume"] }), line)).toMatchObject({
      allowed: false,
      reason: "nested-command",
    });
  });

  it("allows them when there are no command rules", () => {
    expect(check(ps(), "iex 'Get-Date'").allowed).toBe(true);
  });

  it("keeps Set-Location and cd inside the jail", () => {
    const policy = ps();

    expect(check(policy, "Set-Location ..\\..").reason).toBe("path-escape");
    expect(check(policy, "sl -Path ../..").reason).toBe("path-escape");
    expect(check(policy, "cd -LiteralPath:../..").reason).toBe("path-escape");
    expect(check(policy, "chdir ../../x").reason).toBe("path-escape");
    expect(check(policy, "Set-Location sub; Get-ChildItem > out.txt").allowed).toBe(true);
    expect(check(policy, "Set-Location -PassThru sub").reason).toBe("unsupported-syntax");
    expect(check(policy, "Set-Location ~").reason).toBe("unsupported-syntax");
  });

  it("keeps redirections inside the jail", () => {
    const policy = ps({}, process.platform === "win32" ? cwd : posixCwd);

    const outside = process.platform === "win32" ? "C:\\Windows\\x" : "/etc/x";

    expect(checkShellCommandInDialect(policy, `echo x > ${outside}`, "powershell").reason).toBe(
      "path-escape",
    );
    expect(checkShellCommandInDialect(policy, "echo x > $null", "powershell").allowed).toBe(true);
    expect(checkShellCommandInDialect(policy, "git log 2>&1", "powershell").allowed).toBe(true);
    expect(
      checkShellCommandInDialect(policy, "git log 2> err.txt", "powershell").paths,
    ).toHaveLength(1);
    expect(check(ps(), "echo x > $out").reason).toBe("unsupported-syntax");
  });

  it("passes dynamic words to allowCommand only when literal", () => {
    expect(check(ps({ allowCommand: () => true }), "echo $env:HOME").reason).toBe(
      "unsupported-syntax",
    );
  });
});

describe("Windows PowerShell 5.1 dialect", () => {
  it("refuses && and || with a clear message but keeps ;", () => {
    for (const operator of ["&&", "||"]) {
      const parsed = parseShellLine(`git add . ${operator} git commit`, "powershell5");

      expect(parsed).toMatchObject({ ok: false, reason: "unsupported-syntax" });
      expect(parsed.ok === false && parsed.message).toContain(
        `Windows PowerShell 5.1 cannot run ${operator}; use ; or run each command in its own call`,
      );
    }

    expect(parseShellLine("git add . ; git commit", "powershell5").ok).toBe(true);
    expect(parseShellLine("echo $(a && b)", "powershell5").ok).toBe(false);
    expect(parseShellLine("a && b", "powershell").ok).toBe(true);
  });

  it("is checked like PowerShell otherwise", () => {
    const policy = ps({ deny: ["git"] });

    expect(checkShellCommandInDialect(policy, "git status", "powershell5").allowed).toBe(false);
    expect(checkShellCommandInDialect(policy, "git a && ls", "powershell5").allowed).toBe(false);
  });

  it("does not promise chaining in the run_shell description", () => {
    const tool = makeRunShellTool({} as never, {
      shellLabel: "Windows PowerShell 5.1 (powershell)",
      shellDialect: "powershell5",
      platform: "win32",
    });

    expect(tool.description).toContain("using Windows PowerShell 5.1 (powershell).");
    expect(tool.description).toContain("cannot chain with `&&` or `||`");
    expect(tool.description).not.toContain("`;`, `&&`");
  });
});

describe("run_shell description and run_tests quoting", () => {
  it("names the resolved shell and platform", () => {
    const tool = makeRunShellTool({} as never, {
      shellLabel: "PowerShell 7 (pwsh)",
      shellDialect: "powershell",
      platform: "win32",
    });

    expect(tool.description).toContain("Commands run on Windows using PowerShell 7 (pwsh).");
    expect(tool.description).toContain("PowerShell syntax");
  });

  it("is unchanged in argv mode", () => {
    expect(makeRunShellTool({} as never).description).not.toContain("Commands run on");
  });

  it("quotes the pattern for each dialect", () => {
    expect(quotePattern("it's", "powershell")).toBe("'it''s'");
    expect(quotePattern("a\u2019b", "powershell")).toBe("'a\u2019\u2019b'");
    expect(quotePattern("$x `y`", "bash")).toBe("'$x `y`'");
    expect(quotePattern("a'b", "bash")).toBe("'a'\\''b'");
    expect(quotePattern("a b", "cmd")).toBe('"a b"');
    expect(quotePattern("a b", "none")).toBe('"a b"');
    expect(quotePattern("a", "sh", undefined, "win32")).toBe('"a"');
    expect(quotePattern("a b", "sh", undefined, "linux")).toBe("'a b'");
  });

  it("describes the workspace's resolved shell", () => {
    const ws = workspace({
      cwd: path.resolve("."),
      backend: "mock",
      shell: { interpreter: "bash" },
    });
    const description = ws.tools.runShell().description;

    expect(description).toContain("using bash");
  });
});
