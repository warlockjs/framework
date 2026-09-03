import ts from "typescript";
import { describe, expect, it } from "vitest";
import { Name } from "../../../src/cli/commands/generate/utils/name-parser";
import {
  controllerStub,
  crudCreateControllerStub,
  crudDeleteControllerStub,
  crudListControllerStub,
  crudShowControllerStub,
  crudUpdateControllerStub,
} from "../../../src/cli/commands/generate/templates/stubs";
import {
  notificationControllersStub,
  webContactControllerStub,
} from "../../../src/generations/stubs";

/**
 * Structural (AST) proof that every controller-handler
 * emission from the generator stubs uses the v5 single-context-object
 * parameter shape `({ request, response }) => ...` and never the v4
 * positional shape `(request, response) => ...` (`core/src/router/types.ts`:
 * `RequestHandler<TRequest> = { (context: HttpContext<TRequest>): ... }`).
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------
 * This parses each stub's generated source with the real TypeScript parser
 * (`ts.createSourceFile` -- syntax only, no `Program`, no checker, no module
 * resolution) and walks the AST of every arrow function the stub emits,
 * asserting it has exactly one parameter and that parameter is an object
 * destructuring pattern binding the expected names. That is a SHAPE
 * assertion executed against the parser's own AST for the actual generated
 * text -- not a grep over the template string, and not a hand round-trip.
 *
 * It is explicitly NOT a type-check. It does not prove the generated file
 * compiles against the shipped `@warlock.js/core` `RequestHandler` type.
 *
 * A full semantic type-check of generated output against the live
 * `@warlock.js/core` barrel was attempted and abandoned as impractical for a
 * per-test gate: pointing `ts.createProgram` at `src/index.ts` pulls in the
 * whole framework's transitive graph (ai, cascade, notifications, web,
 * socket, ...). A standalone run (no vitest/vite involved) against ONE
 * trivial file that only imports `{ type RequestHandler }` from
 * `@warlock.js/core` took roughly 74s just to build the `Program` (3028
 * source files reachable) and another roughly 177s to compute diagnostics --
 * about 250s total for a single assignment. That does not belong as a
 * per-test compile inside `core`'s suite. A generated-output type-check gate
 * belongs folded into the existing skill-snippet compile gate,
 * which already owns "compile a generated snippet against the
 * shipped types" -- this is deliberately not built as a second, competing
 * gate.
 *
 * Separately -- and out of this card's fence -- `controllerStub` and the
 * `crud*ControllerStub` functions emit `GuardedRequestHandler`, imported
 * from `app/auth/requests/guarded.request`. That module exists only inside
 * a project scaffolded by `create-warlock` (and itself imports
 * `app/users/models/user`, the scaffolded app's own model) -- there is no
 * live or shipped declaration set for it inside `core` to type-check
 * against at all.
 */

/** Parses generated source with the TS parser only (no type information). */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "generated.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
}

/** Every arrow function's parameter list found anywhere in the source, in document order. */
function findArrowFunctionParameterLists(
  source: string,
): ReadonlyArray<ts.NodeArray<ts.ParameterDeclaration>> {
  const sourceFile = parse(source);
  const results: ts.NodeArray<ts.ParameterDeclaration>[] = [];

  function visit(node: ts.Node) {
    if (ts.isArrowFunction(node)) {
      results.push(node.parameters);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * True when the parameter list is the v5 shape: exactly one parameter, and
 * that parameter is an object destructuring pattern binding exactly
 * `expectedNames` (order-insensitive).
 */
function isV5ContextParam(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  expectedNames: string[],
): boolean {
  if (parameters.length !== 1) return false;

  const [param] = parameters;
  if (!ts.isObjectBindingPattern(param.name)) return false;

  const boundNames = param.name.elements
    .map((element) => (ts.isIdentifier(element.name) ? element.name.text : undefined))
    .filter((name): name is string => name !== undefined)
    .sort();

  const sortedExpected = [...expectedNames].sort();

  return (
    boundNames.length === sortedExpected.length &&
    boundNames.every((name, index) => name === sortedExpected[index])
  );
}

describe("generate.controller stub handlers (src/cli/commands/generate/templates/stubs.ts)", () => {
  it("controllerStub (no validation) emits a single-param object context binding only response", () => {
    const [params] = findArrowFunctionParameterLists(controllerStub(new Name("create-user")));
    expect(isV5ContextParam(params, ["response"])).toBe(true);
  });

  it("controllerStub (withValidation) emits a single-param object context binding only response", () => {
    const output = controllerStub(new Name("create-user"), { withValidation: true });
    const [params] = findArrowFunctionParameterLists(output);
    expect(isV5ContextParam(params, ["response"])).toBe(true);
  });

  it("crudCreateControllerStub emits a single-param object context binding request and response", () => {
    const [params] = findArrowFunctionParameterLists(crudCreateControllerStub(new Name("product")));
    expect(isV5ContextParam(params, ["request", "response"])).toBe(true);
  });

  it("crudUpdateControllerStub emits a single-param object context binding request and response", () => {
    const [params] = findArrowFunctionParameterLists(crudUpdateControllerStub(new Name("product")));
    expect(isV5ContextParam(params, ["request", "response"])).toBe(true);
  });

  it("crudListControllerStub emits a single-param object context binding request and response", () => {
    const [params] = findArrowFunctionParameterLists(crudListControllerStub(new Name("product")));
    expect(isV5ContextParam(params, ["request", "response"])).toBe(true);
  });

  it("crudShowControllerStub emits a single-param object context binding request and response", () => {
    const [params] = findArrowFunctionParameterLists(crudShowControllerStub(new Name("product")));
    expect(isV5ContextParam(params, ["request", "response"])).toBe(true);
  });

  it("crudDeleteControllerStub emits a single-param object context binding request and response", () => {
    const [params] = findArrowFunctionParameterLists(crudDeleteControllerStub(new Name("product")));
    expect(isV5ContextParam(params, ["request", "response"])).toBe(true);
  });
});

describe("generation stub handlers (src/generations/stubs.ts)", () => {
  it("every notificationControllersStub handler emits a single-param object context binding request and response", () => {
    const parameterLists = findArrowFunctionParameterLists(notificationControllersStub);

    // list, unread-count, mark-read, mark-all-read, clear, delete
    expect(parameterLists).toHaveLength(6);

    for (const params of parameterLists) {
      expect(isV5ContextParam(params, ["request", "response"])).toBe(true);
    }
  });

  it("webContactControllerStub (already v5 pre-fix) emits a single-param object context binding request and response", () => {
    const [params] = findArrowFunctionParameterLists(webContactControllerStub);
    expect(isV5ContextParam(params, ["request", "response"])).toBe(true);
  });
});

describe("RED CONTROL: the shape check rejects the pre-fix v4 positional signature", () => {
  it("flags a hand-reconstructed pre-fix positional handler as NOT the v5 shape", () => {
    // The exact pre-fix form listNotificationsController had before this
    // card: two bare positional parameters, no destructuring.
    const positional = `import { type Request, type RequestHandler, type Response } from "@warlock.js/core";
import { inApp } from "@warlock.js/notifications";

export const listNotificationsController: RequestHandler = async (
  request: Request,
  response: Response,
) => {
  const { data, pagination } = await inApp.list(request.user!, request.all());

  return response.success({ notifications: data, pagination });
};
`;

    const [params] = findArrowFunctionParameterLists(positional);

    // Ground truth about what the check actually observed on the reverted stub:
    expect(params).toHaveLength(2);
    expect(ts.isIdentifier(params[0].name) && params[0].name.text).toBe("request");
    expect(ts.isIdentifier(params[1].name) && params[1].name.text).toBe("response");

    // And therefore the shape check rejects it -- this is the exact
    // assertion that passes on every fixed stub above and would have
    // failed before the fix.
    expect(isV5ContextParam(params, ["request", "response"])).toBe(false);
  });
});
