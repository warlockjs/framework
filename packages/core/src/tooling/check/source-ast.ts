import * as ast from "../syntax/ast";
import type { WarlockErrorCode } from "../../errors/error-codes";

export type SourceFinding = {
  code: WarlockErrorCode;
  node: ast.Node;
  message: string;
  severity?: "error" | "warning";
};
export type MemberAccess = ast.MemberExpression;
export const isMemberAccess = (node: ast.Node): node is MemberAccess =>
  node.type === "MemberExpression";
export const keyName = ast.keyName;
export const positionOf = ast.positionOf;

export function unwrap(node: ast.Node): ast.Node {
  let current = node;
  while (
    [
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSNonNullExpression",
      "TSTypeAssertion",
      "TSSatisfiesExpression",
      "ChainExpression",
    ].includes(current.type)
  )
    current = ast.expressionOf(current);
  return current;
}
export function literalString(node: ast.Node | null | undefined): string | undefined {
  if (!node) return undefined;
  const value = unwrap(node);
  if (ast.isStringLiteral(value)) return value.value;
  if (ast.isNoSubstitutionTemplateLiteral(value)) return value.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}
export function memberName(node: MemberAccess): string | undefined {
  return node.computed ? literalString(node.property) : ast.keyName(node.property);
}
export function calleeName(call: ast.CallExpression | ast.NewExpression): string | undefined {
  const callee = unwrap(call.callee);
  return callee.type === "Identifier"
    ? callee.name
    : isMemberAccess(callee)
      ? memberName(callee)
      : undefined;
}
export function rootIdentifier(node: ast.Node): ast.Identifier | undefined {
  let current = unwrap(node);
  for (;;) {
    if (current.type === "Identifier") return current;
    if (isMemberAccess(current) || current.type === "CallExpression")
      current = unwrap(ast.expressionOf(current));
    else return undefined;
  }
}
export function isFunctionLike(
  node: ast.Node,
): node is ast.FunctionDeclaration | ast.FunctionExpression | ast.ArrowFunctionExpression {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}
export function walk(
  node: ast.Node,
  visit: (node: ast.Node) => boolean | void,
  enterFunctions = false,
): void {
  if (visit(node) === false || (!enterFunctions && isFunctionLike(node))) return;
  ast.forEachChild(node, (child) => {
    if (
      !child.type.startsWith("TS") ||
      ("expression" in child && typeof child.expression === "object")
    )
      walk(child, visit, enterFunctions);
  });
}
export function ancestors(node: ast.Node): ast.Node[] {
  const list: ast.Node[] = [];
  let current = ast.parentOf(node);
  while (current) {
    list.push(current);
    current = ast.parentOf(current);
  }
  return list;
}
export function isValueReference(identifier: ast.Identifier): boolean {
  const parent = ast.parentOf(identifier);
  if (!parent) return true;
  if (parent.type === "MemberExpression") return parent.object === identifier || parent.computed;
  if (parent.type === "Property") return parent.value === identifier || parent.computed;
  if (parent.type === "VariableDeclarator") return parent.id !== identifier;
  if (
    (isFunctionLike(parent) ||
      parent.type === "ClassDeclaration" ||
      parent.type === "ClassExpression") &&
    parent.id === identifier
  )
    return false;
  return ![
    "ImportSpecifier",
    "ImportDefaultSpecifier",
    "ImportNamespaceSpecifier",
    "ExportSpecifier",
    "JSXAttribute",
    "LabeledStatement",
    "BreakStatement",
    "ContinueStatement",
    "TSPropertySignature",
    "PropertyDefinition",
    "MethodDefinition",
    "RestElement",
    "ArrayPattern",
    "ObjectPattern",
  ].includes(parent.type);
}

type Declaration = ast.VariableDeclarator | "other";
function bindingDeclares(binding: ast.Node, name: string): boolean {
  if (binding.type === "Identifier") return binding.name === name;
  if (binding.type === "RestElement") return bindingDeclares(binding.argument, name);
  if (binding.type === "AssignmentPattern") return bindingDeclares(binding.left, name);
  if (binding.type === "ObjectPattern")
    return binding.properties.some((property) =>
      bindingDeclares(property.type === "RestElement" ? property.argument : property.value, name),
    );
  if (binding.type === "ArrayPattern")
    return binding.elements.some((element) => element !== null && bindingDeclares(element, name));
  return false;
}
function declarationsDeclare(list: ast.VariableDeclaration, name: string): Declaration | undefined {
  for (const declaration of list.declarations) {
    if (bindingDeclares(declaration.id, name))
      return declaration.id.type === "Identifier" ? declaration : "other";
  }
  return undefined;
}
function statementsDeclare(
  statements: readonly ast.Statement[],
  name: string,
): Declaration | undefined {
  for (let statement of statements) {
    if (statement.type === "ExportNamedDeclaration" && statement.declaration)
      statement = statement.declaration;
    if (statement.type === "VariableDeclaration") {
      const found = declarationsDeclare(statement, name);
      if (found) return found;
    } else if (ast.declarationName(statement) === name) return "other";
    else if (
      statement.type === "ImportDeclaration" &&
      statement.specifiers.some((specifier) => specifier.local.name === name)
    )
      return "other";
  }
  return undefined;
}
function scopeDeclares(scope: ast.Node, name: string): Declaration | undefined {
  if (scope.type === "Program" || scope.type === "BlockStatement" || scope.type === "TSModuleBlock")
    return statementsDeclare(scope.body, name);
  if (scope.type === "SwitchStatement") {
    for (const clause of scope.cases) {
      const found = statementsDeclare(clause.consequent, name);
      if (found) return found;
    }
  }
  if (isFunctionLike(scope)) {
    if (scope.params.some((parameter) => bindingDeclares(parameter, name))) return "other";
    if (scope.type === "FunctionExpression" && scope.id?.name === name) return "other";
  }
  if (
    scope.type === "ForStatement" ||
    scope.type === "ForInStatement" ||
    scope.type === "ForOfStatement"
  ) {
    const initializer = scope.type === "ForStatement" ? scope.init : scope.left;
    if (initializer?.type === "VariableDeclaration" && declarationsDeclare(initializer, name))
      return "other";
  }
  if (scope.type === "CatchClause" && scope.param && bindingDeclares(scope.param, name))
    return "other";
  return undefined;
}
export function findDeclaration(identifier: ast.Identifier): Declaration | undefined {
  for (const scope of ancestors(identifier)) {
    const found = scopeDeclares(scope, identifier.name);
    if (found) return found;
  }
  return undefined;
}
function isReassigned(declaration: ast.VariableDeclarator): boolean {
  const name = declaration.id;
  if (name.type !== "Identifier") return true;
  let reassigned = false;
  walk(
    ast.sourceOf(declaration),
    (node) => {
      if (reassigned) return false;
      const target =
        node.type === "AssignmentExpression"
          ? unwrap(node.left)
          : node.type === "UpdateExpression"
            ? unwrap(node.argument)
            : undefined;
      if (
        target?.type === "Identifier" &&
        target.name === name.name &&
        findDeclaration(target) === declaration
      )
        reassigned = true;
      return undefined;
    },
    true,
  );
  return reassigned;
}
export function resolveInitializer(identifier: ast.Identifier): ast.Expression | undefined {
  const declaration = findDeclaration(identifier);
  if (!declaration || declaration === "other" || !declaration.init) return undefined;
  const list = ast.parentOf(declaration);
  if (!(list?.type === "VariableDeclaration" && list.kind === "const") && isReassigned(declaration))
    return undefined;
  return declaration.init;
}
export function referencesOf(declaration: ast.VariableDeclarator): ast.Identifier[] {
  const name = declaration.id;
  if (name.type !== "Identifier") return [];
  const found: ast.Identifier[] = [];
  walk(
    ast.sourceOf(declaration),
    (node) => {
      if (
        node.type === "Identifier" &&
        node !== name &&
        node.name === name.name &&
        isValueReference(node) &&
        findDeclaration(node) === declaration
      )
        found.push(node);
      return undefined;
    },
    true,
  );
  return found;
}
