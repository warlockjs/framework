import * as ast from "../../../src/tooling/syntax/ast";
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
  listNotificationsControllerStub,
  markAllNotificationsReadControllerStub,
  markNotificationReadControllerStub,
  unreadNotificationsCountControllerStub,
  webContactControllerStub,
} from "../../../src/generations/stubs";

/** OXC verifies the actual generated handler syntax: one object context parameter.
 * Semantic compilation is covered separately by the generated-output compiler specs.
 */
function findArrowFunctionParameterLists(source: string): ast.ParamPattern[][] {
  const lists: ast.ParamPattern[][] = [];
  const visit = (node: ast.Node): void => {
    if (node.type === "ArrowFunctionExpression") lists.push(node.params);
    ast.forEachChild(node, visit);
  };
  visit(ast.parseSourceFile("generated.ts", source));
  return lists;
}
function isV5ContextParam(parameters: ast.ParamPattern[], expectedNames: string[]): boolean {
  if (parameters.length !== 1) return false;
  const [parameter] = parameters;
  if (parameter?.type !== "ObjectPattern") return false;
  const names = parameter.properties
    .map((property) =>
      property.type === "Property" && property.value.type === "Identifier"
        ? property.value.name
        : undefined,
    )
    .filter((name): name is string => name !== undefined)
    .sort();
  return (
    names.length === expectedNames.length &&
    names.every((name, index) => name === [...expectedNames].sort()[index])
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
  it("every notifications controller stub emits one single-param object context binding request and response", () => {
    const stubs = [
      listNotificationsControllerStub,
      unreadNotificationsCountControllerStub,
      markNotificationReadControllerStub,
      markAllNotificationsReadControllerStub,
    ];

    for (const stub of stubs) {
      const parameterLists = findArrowFunctionParameterLists(stub);

      // One controller per file.
      expect(parameterLists).toHaveLength(1);
      expect(isV5ContextParam(parameterLists[0], ["request", "response"])).toBe(true);
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
    expect(params[0]?.type === "Identifier" && params[0].name).toBe("request");
    expect(params[1]?.type === "Identifier" && params[1].name).toBe("response");

    // And therefore the shape check rejects it -- this is the exact
    // assertion that passes on every fixed stub above and would have
    // failed before the fix.
    expect(isV5ContextParam(params, ["request", "response"])).toBe(false);
  });
});
