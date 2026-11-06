import { describe, expect, it } from "vitest";
import { checkShellCommand, findWindowsStylePath } from "./policy/shell-check";
import { makeRunShellTool } from "./tools/run-shell";
import { createMockBackend } from "./backends/mock";
import { createOps } from "./ops";
import type { WorkspacePolicy } from "./contracts";

const policy: WorkspacePolicy = {
  cwd: "/srv/app",
  shell: { allow: ["cd", "ls", "npm", "echo", "grep"], interpreter: "bash" },
};

const resolved = { interpreter: "bash", dialect: "posix", label: "bash" } as const;

const check = (command: string, platform: NodeJS.Platform) =>
  checkShellCommand(policy, command, { resolved, platform });

describe("Windows-style paths under bash", () => {
  it("refuses an unquoted backslash path on Windows and shows the forward-slash form", () => {
    const verdict = check("cd ab\\x\\y && ls", "win32");

    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("ab/x/y");
    expect(verdict.message).toContain("forward slashes");
  });

  it("refuses a drive path and a dotted segment", () => {
    expect(check("ls C:\\work\\app", "win32").message).toContain("C:/work/app");
    expect(check("ls src\\.hidden", "win32").allowed).toBe(false);
  });

  it("accepts quoted paths, escaped spaces and forward slashes on Windows", () => {
    for (const line of [
      'ls "ab\\x\\y"',
      "ls 'ab\\x\\y'",
      "ls a\\ b",
      "ls ab/x/y",
      'echo "say \\"hi\\""',
    ]) {
      const verdict = check(line, "win32");

      expect(verdict.message, line).toBeUndefined();
      expect(verdict.allowed, line).toBe(true);
    }
  });

  it("leaves bash on Linux and macOS unchanged", () => {
    expect(check("ls ab\\x\\y", "linux").allowed).toBe(true);
    expect(check("ls ab\\x\\y", "darwin").allowed).toBe(true);
  });

  it("rewrites only the unquoted backslashes of the offending word", () => {
    expect(findWindowsStylePath('cd "a b"\\c\\d')?.suggestion).toBe('"a b"/c/d');
    expect(findWindowsStylePath("echo ok")).toBeNull();
  });

  it("states the forward-slash rule in the tool description for bash on Windows only", () => {
    const ops = createOps(createMockBackend(), policy);
    const on = (platform: NodeJS.Platform) =>
      makeRunShellTool(ops, { shellLabel: "bash", shellDialect: "posix", platform }).description;

    expect(on("win32")).toContain("forward slashes");
    expect(on("linux")).not.toContain("forward slashes");
  });
});
