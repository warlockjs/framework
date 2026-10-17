import { describe, expect, it } from "vitest";
import { buildInvocation, fitsCommandLine, quoteForCmd } from "./invocation";
import {
  type CommandLookup,
  findExecutable,
  parseCmdShim,
  readEnv,
  resolveSpawnTarget,
} from "./resolve-command";

/** npm's cmd-shim output for a JavaScript bin. */
const NPM_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  "",
].join("\r\n");

/** pnpm's shim layout. */
const PNPM_SHIM = [
  "@SETLOCAL",
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\..\\@openai\\codex\\bin\\codex.js" %*',
  ") ELSE (",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  '  node  "%~dp0\\..\\@openai\\codex\\bin\\codex.js" %*',
  ")",
].join("\r\n");

/** A shim around a native executable. */
const NATIVE_SHIM = ["@ECHO off", '"%dp0%\\node_modules\\droid\\bin\\droid.exe"   %*'].join("\r\n");

function windowsLookup(
  files: Record<string, string>,
  env: Record<string, string> = {},
): CommandLookup {
  const lower = new Map(
    Object.entries(files).map(([file, content]) => [file.toLowerCase(), content]),
  );

  return {
    platform: "win32",
    env: {
      Path: "C:\\Windows\\System32;C:\\Users\\dev\\AppData\\Roaming\\npm",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      ...env,
    },
    isFile: (file) => lower.has(file.toLowerCase()),
    readFile: (file) => lower.get(file.toLowerCase()),
    execPath: "C:\\Program Files\\nodejs\\node.exe",
  };
}

describe("findExecutable", () => {
  it("walks PATH with PATHEXT on Windows, reading Path case-insensitively", () => {
    const lookup = windowsLookup({ "C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd": NPM_SHIM });

    expect(findExecutable("claude", lookup)).toBe(
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd",
    );
    expect(readEnv(lookup.env, "PATH", "win32")).toContain("npm");
  });

  it("prefers the first PATHEXT extension and accepts an explicit one", () => {
    const lookup = windowsLookup({
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.exe": "",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd": NPM_SHIM,
    });

    expect(findExecutable("codex", lookup)).toMatch(/codex\.exe$/i);
    expect(findExecutable("codex.cmd", lookup)).toMatch(/codex\.cmd$/i);
  });

  it("checks a path directly instead of searching", () => {
    const lookup = windowsLookup({ "D:\\tools\\agy.exe": "" });

    expect(findExecutable("D:\\tools\\agy", lookup)).toBe("D:\\tools\\agy.exe");
  });

  it("walks PATH on POSIX without extensions", () => {
    const lookup: CommandLookup = {
      platform: "linux",
      env: { PATH: "/usr/bin:/home/dev/.local/bin" },
      isFile: (file) => file === "/home/dev/.local/bin/cursor-agent",
      readFile: () => undefined,
      execPath: "/usr/bin/node",
    };

    expect(findExecutable("cursor-agent", lookup)).toBe("/home/dev/.local/bin/cursor-agent");
    expect(findExecutable("missing", lookup)).toBeUndefined();
  });
});

describe("npm .cmd shims", () => {
  it("unwraps an npm shim to node <script>", () => {
    expect(parseCmdShim(NPM_SHIM, "C:\\npm\\claude.cmd")).toEqual({
      type: "node",
      script: "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
    });
  });

  it("unwraps a pnpm shim", () => {
    expect(parseCmdShim(PNPM_SHIM, "C:\\pnpm\\bin\\codex.cmd")).toEqual({
      type: "node",
      script: "C:\\pnpm\\@openai\\codex\\bin\\codex.js",
    });
  });

  it("unwraps a native-executable shim", () => {
    expect(parseCmdShim(NATIVE_SHIM, "C:\\npm\\droid.cmd")).toEqual({
      type: "native",
      file: "C:\\npm\\node_modules\\droid\\bin\\droid.exe",
    });
  });

  it("returns undefined for an arbitrary batch file", () => {
    expect(parseCmdShim("@echo off\r\necho hi\r\n", "C:\\tools\\x.bat")).toBeUndefined();
  });

  it("resolves a shim to a direct node spawn, using a bundled node.exe when present", () => {
    const npm = "C:\\Users\\dev\\AppData\\Roaming\\npm";
    const withoutNode = windowsLookup({ [`${npm}\\claude.cmd`]: NPM_SHIM });
    const withNode = windowsLookup({ [`${npm}\\claude.cmd`]: NPM_SHIM, [`${npm}\\node.exe`]: "" });

    expect(resolveSpawnTarget("claude", withoutNode)).toEqual({
      type: "direct",
      file: "C:\\Program Files\\nodejs\\node.exe",
      prefixArgs: [`${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`],
      executable: `${npm}\\claude.cmd`,
    });
    expect(resolveSpawnTarget("claude", withNode)).toMatchObject({ file: `${npm}\\node.exe` });
  });

  it("falls back to cmd.exe for a batch file it cannot unwrap", () => {
    const lookup = windowsLookup({
      "C:\\Windows\\System32\\agent.bat": "@echo off\r\nsomething %*\r\n",
    });

    expect(resolveSpawnTarget("agent", lookup)).toEqual({
      type: "cmd",
      file: "C:\\Windows\\System32\\agent.bat",
      executable: "C:\\Windows\\System32\\agent.bat",
    });
  });
});

describe("cmd.exe quoting", () => {
  it("quotes every element and keeps shell metacharacters literal", () => {
    const invocation = buildInvocation(
      { type: "cmd", file: "C:\\tools\\agent.bat", executable: "C:\\tools\\agent.bat" },
      ["-p", "fix a & b | c > d"],
      "C:\\Windows\\System32\\cmd.exe",
    );

    expect(invocation).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/v:off", "/s", "/c", '""C:\\tools\\agent.bat" "-p" "fix a & b | c > d""'],
      windowsVerbatimArguments: true,
    });
  });

  it("refuses bytes cmd.exe cannot carry", () => {
    for (const unsafe of ['say "hi"', "100%", "two\nlines", "cr\r"]) {
      expect(quoteForCmd(unsafe)).toBeNull();
    }

    expect(
      buildInvocation({ type: "cmd", file: "a.bat", executable: "a.bat" }, ["50% done"], "cmd.exe"),
    ).toEqual({ refused: expect.stringContaining("cmd.exe") });
  });

  it("doubles trailing backslashes so the closing quote is not escaped", () => {
    expect(quoteForCmd("C:\\dir\\")).toBe('"C:\\dir\\\\"');
  });

  it("passes argv through untouched for a direct target", () => {
    expect(
      buildInvocation(
        { type: "direct", file: "node", prefixArgs: ["cli.js"], executable: "claude.cmd" },
        ['say "hi"'],
        "cmd.exe",
      ),
    ).toEqual({ file: "node", args: ["cli.js", 'say "hi"'], windowsVerbatimArguments: false });
  });
});

describe("command-line limits", () => {
  it("applies the cmd.exe and CreateProcess limits on Windows", () => {
    const viaCmd = { file: "cmd.exe", args: ["x".repeat(9000)], windowsVerbatimArguments: true };
    const direct = { file: "node.exe", args: ["x".repeat(9000)], windowsVerbatimArguments: false };

    expect(fitsCommandLine(viaCmd, "win32")).toBe(false);
    expect(fitsCommandLine(direct, "win32")).toBe(true);
    expect(fitsCommandLine({ ...direct, args: ["x".repeat(40_000)] }, "win32")).toBe(false);
  });

  it("applies the per-argument limit on POSIX", () => {
    expect(
      fitsCommandLine(
        { file: "claude", args: ["x".repeat(100_000)], windowsVerbatimArguments: false },
        "linux",
      ),
    ).toBe(true);
    expect(
      fitsCommandLine(
        { file: "claude", args: ["x".repeat(200_000)], windowsVerbatimArguments: false },
        "linux",
      ),
    ).toBe(false);
  });
});
