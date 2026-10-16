import { describe, expect, it } from "vitest";
import { tokenizeCommand } from "./tokenize-command";

describe("tokenizeCommand", () => {
  it("splits a plain command on whitespace", () => {
    expect(tokenizeCommand("npm run build --watch")).toEqual(["npm", "run", "build", "--watch"]);
  });

  it("keeps a quoted span (including whitespace and metacharacters) one token", () => {
    expect(tokenizeCommand('node -e "console.log(1); process.exit(0)"')).toEqual([
      "node",
      "-e",
      "console.log(1); process.exit(0)",
    ]);
    expect(tokenizeCommand("grep 'a|b' file.txt")).toEqual(["grep", "a|b", "file.txt"]);
  });

  it("concatenates adjacent quoted/unquoted spans into one token", () => {
    expect(tokenizeCommand('foo"bar baz"qux')).toEqual(["foobar bazqux"]);
  });

  it("treats a backslash as a literal byte (Windows paths survive)", () => {
    expect(tokenizeCommand("node scripts\\build.js")).toEqual(["node", "scripts\\build.js"]);
  });

  it("returns null for every unquoted shell metacharacter and newline", () => {
    const rejected = [
      "npm test; curl http://evil",
      "npm test && curl http://evil",
      "npm test | sh",
      "npm test `whoami`",
      "npm test $(whoami)",
      "npm test > out.txt",
      "npm test < in.txt",
      "npm test $HOME",
      "npm (test)",
      "npm test\ncurl http://evil",
    ];

    for (const command of rejected) {
      expect(tokenizeCommand(command)).toBeNull();
    }
  });

  it("returns null for an unbalanced quote", () => {
    expect(tokenizeCommand('npm test "unclosed')).toBeNull();
    expect(tokenizeCommand("npm test 'unclosed")).toBeNull();
  });

  it("returns null for an empty or whitespace-only command", () => {
    expect(tokenizeCommand("")).toBeNull();
    expect(tokenizeCommand("   ")).toBeNull();
  });
});
