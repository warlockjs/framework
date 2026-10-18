import ts from "typescript";
import { describe, expect, it } from "vitest";
import { codeStyleFindings } from "./code-style-conventions";

type Found = { code: string; severity: string; text: string; message: string };

function check(source: string): Found[] {
  const sourceFile = ts.createSourceFile("src/app/a.ts", source, ts.ScriptTarget.Latest, true);

  return codeStyleFindings(sourceFile).map((finding) => ({
    code: finding.code,
    severity: finding.severity ?? "error",
    text: finding.node.getText(sourceFile),
    message: finding.message,
  }));
}

describe("WL9010 await on a synchronous log call", () => {
  it.each([
    "log.info('a', 'b', 'c');",
    "async function f() { await log.flush(); }",
    "async function f() { await mailer.send(message); }",
    "async function f() { await other.info('x'); }",
  ])("accepts %s", (source) => {
    expect(check(source)).toEqual([]);
  });

  it("warns about await log.info()", () => {
    expect(check("async function f() { await log.info('auth', 'login', 'ok'); }")).toEqual([
      {
        code: "WL9010",
        severity: "warning",
        text: "await log.info('auth', 'login', 'ok')",
        message: expect.stringContaining("`log.info()` returns the logger synchronously"),
      },
    ]);
  });

  it("warns about return await logger.error()", () => {
    expect(
      check("async function f() { return await logger.error('x', 'y', error); }").map(
        (found) => found.code,
      ),
    ).toEqual(["WL9010"]);
  });
});

describe("WL9011 one controller per file", () => {
  it.each([
    "export const loginController: RequestHandler = async ({ request, response }) => response.success();",
    "export const loginController = async () => {};\nloginController.validation = { schema };",
    "export const schema = v.object({});\nexport function helper() {}",
  ])("accepts %s", (source) => {
    expect(check(source)).toEqual([]);
  });

  it("warns about the second controller, naming the first", () => {
    expect(
      check(
        "export const loginController = async () => {};\nexport const logoutController = async () => {};",
      ),
    ).toEqual([
      {
        code: "WL9011",
        severity: "warning",
        text: "logoutController",
        message:
          "`logoutController` is the 2nd controller in this file (after `loginController`). Move it to its own `*.controller.ts` file.",
      },
    ]);
  });

  it("recognises handlers by their RequestHandler type and functions by name", () => {
    const found = check(
      "export const list: RequestHandler = async () => {};\nexport const show: GuardedRequestHandler = async () => {};\nexport async function removeController() {}",
    );

    expect(found.map((item) => item.text)).toEqual(["show", "removeController"]);
    expect(found[1]?.message).toContain("is the 3rd controller in this file (after `list`)");
  });
});

describe("WL9012 type, not kind, as the discriminator", () => {
  it.each([
    "type Shape = { type: 'circle'; radius: number } | { type: 'square'; size: number };",
    "interface Node { kind: SyntaxKind }",
    "type Token = { kind: string };",
  ])("accepts %s", (source) => {
    expect(check(source)).toEqual([]);
  });

  it("warns about each kind tag of a union", () => {
    const found = check(
      "type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; size: number };",
    );

    expect(found.map((item) => [item.code, item.severity, item.text])).toEqual([
      ["WL9012", "warning", "kind"],
      ["WL9012", "warning", "kind"],
    ]);
  });

  it("warns about a kind whose type is a union of literals", () => {
    expect(
      check("interface Event { kind: 'created' | 'deleted'; id: string }").map(
        (found) => found.code,
      ),
    ).toEqual(["WL9012"]);
  });
});
