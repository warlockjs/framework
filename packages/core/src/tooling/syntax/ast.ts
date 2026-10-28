import { parseSync, visitorKeys, type Node, type Program } from "oxc-parser";
export type * from "oxc-parser";

export type SourceFile = Program & { fileName: string; text: string };
/**
 * Parent links live on the nodes themselves, as a non-enumerable property.
 * They used to sit in a `WeakMap`, whose entries chain from child to parent
 * to grandparent; the garbage collector resolves such ephemeron chains
 * slowly, which stalled a check over thousands of files for seconds at a time.
 */
const PARENT = Symbol("warlock.parent");

export function forEachChild(node: Node, visit: (node: Node) => void): void {
  const record = node as unknown as Record<string, unknown>;
  for (const key of visitorKeys[node.type] ?? []) {
    const value = record[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === "object" && "type" in child) visit(child as Node);
    }
  }
}

export function parseSourceFile(fileName: string, text: string): SourceFile {
  const source = Object.assign(parseSync(fileName, text).program, { fileName, text });
  const attach = (node: Node): void => {
    forEachChild(node, (child) => {
      Object.defineProperty(child, PARENT, { value: node, configurable: true });
      attach(child);
    });
  };
  attach(source);
  return source;
}
export function parentOf(node: Node): Node | undefined {
  return (node as unknown as Record<symbol, Node | undefined>)[PARENT];
}
export function sourceOf(node: Node): SourceFile {
  let current = node;
  for (let parent = parentOf(current); parent; parent = parentOf(current)) current = parent;
  if (current.type !== "Program" || !("text" in current))
    throw new Error("Node has no source file.");
  return current as SourceFile;
}
export function textOf(node: Node): string {
  return node.type === "Identifier" ? node.name : sourceOf(node).text.slice(node.start, node.end);
}
export function keyName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  const parent = parentOf(node);
  if (parent && "computed" in parent && parent.computed) return undefined;
  if (node.type === "Identifier" || node.type === "PrivateIdentifier") return node.name;
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number"))
    return String(node.value);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}
export function positionOf(source: SourceFile, node: Node): { line: number; column: number } {
  const lines = source.text.slice(0, node.start).split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function expressionOf(node: Node): Node {
  if (node.type === "CallExpression" || node.type === "NewExpression") return node.callee;
  if (node.type === "MemberExpression") return node.object;
  if (node.type === "AwaitExpression" || node.type === "SpreadElement") return node.argument;
  if (node.type === "IfStatement") return node.test;
  if ("expression" in node && node.expression && typeof node.expression === "object")
    return node.expression;
  throw new Error(`No expression on ${node.type}.`);
}
export function nameNode(node: Node): Node {
  if ("id" in node && node.id) return node.id;
  if ("key" in node) return node.key;
  if (
    node.type === "ImportSpecifier" ||
    node.type === "ImportDefaultSpecifier" ||
    node.type === "ImportNamespaceSpecifier"
  )
    return node.local;
  if (node.type === "JSXAttribute") return node.name;
  throw new Error(`No name on ${node.type}.`);
}
export function declarationName(node: Node): string | undefined {
  return "id" in node && node.id?.type === "Identifier" ? node.id.name : undefined;
}
export function valueText(node: Node): string {
  return keyName(node) ?? (node.type === "Literal" ? (node.raw ?? "") : textOf(node));
}
export function initializerOf(
  node: import("oxc-parser").ObjectProperty,
): import("oxc-parser").Expression;
export function initializerOf(node: Node): Node | null;
export function initializerOf(node: Node): Node | null {
  if (node.type === "Property") return node.value;
  if (node.type === "VariableDeclarator") return node.init;
  if (node.type === "PropertyDefinition" || node.type === "JSXAttribute") return node.value;
  return null;
}

export function isCallExpression(node: Node): node is Node & { type: "CallExpression" } {
  return node.type === "CallExpression";
}

export function isNewExpression(node: Node): node is Node & { type: "NewExpression" } {
  return node.type === "NewExpression";
}

export function isIdentifier(node: Node): node is Node & { type: "Identifier" } {
  return node.type === "Identifier";
}

export function isObjectLiteralExpression(node: Node): node is Node & { type: "ObjectExpression" } {
  return node.type === "ObjectExpression";
}

export function isVariableDeclaration(node: Node): node is Node & { type: "VariableDeclarator" } {
  return node.type === "VariableDeclarator";
}

export function isVariableStatement(node: Node): node is Node & { type: "VariableDeclaration" } {
  return node.type === "VariableDeclaration";
}

export function isImportDeclaration(node: Node): node is Node & { type: "ImportDeclaration" } {
  return node.type === "ImportDeclaration";
}

export function isPropertyAssignment(
  node: Node,
): node is Node & { type: "Property"; shorthand: false; method: false; kind: "init" } {
  return node.type === "Property" && !node.shorthand && !node.method && node.kind === "init";
}

export function isShorthandPropertyAssignment(
  node: Node,
): node is Node & { type: "Property"; shorthand: true } {
  return node.type === "Property" && node.shorthand;
}

export function isPropertyDeclaration(node: Node): node is Node & { type: "PropertyDefinition" } {
  return node.type === "PropertyDefinition";
}

export function isExportAssignment(
  node: Node,
): node is Node & { type: "ExportDefaultDeclaration" } {
  return node.type === "ExportDefaultDeclaration";
}

export function isExportDeclaration(node: Node): node is Node & { type: "ExportNamedDeclaration" } {
  return node.type === "ExportNamedDeclaration";
}

export function isClassDeclaration(node: Node): node is Node & { type: "ClassDeclaration" } {
  return node.type === "ClassDeclaration";
}

export function isClassExpression(node: Node): node is Node & { type: "ClassExpression" } {
  return node.type === "ClassExpression";
}

export function isFunctionDeclaration(node: Node): node is Node & { type: "FunctionDeclaration" } {
  return node.type === "FunctionDeclaration";
}

export function isFunctionExpression(node: Node): node is Node & { type: "FunctionExpression" } {
  return node.type === "FunctionExpression";
}

export function isArrowFunction(node: Node): node is Node & { type: "ArrowFunctionExpression" } {
  return node.type === "ArrowFunctionExpression";
}

export function isInterfaceDeclaration(
  node: Node,
): node is Node & { type: "TSInterfaceDeclaration" } {
  return node.type === "TSInterfaceDeclaration";
}

export function isTypeAliasDeclaration(
  node: Node,
): node is Node & { type: "TSTypeAliasDeclaration" } {
  return node.type === "TSTypeAliasDeclaration";
}

export function isTypeReferenceNode(node: Node): node is Node & { type: "TSTypeReference" } {
  return node.type === "TSTypeReference";
}

export function isAwaitExpression(node: Node): node is Node & { type: "AwaitExpression" } {
  return node.type === "AwaitExpression";
}

export function isArrayLiteralExpression(node: Node): node is Node & { type: "ArrayExpression" } {
  return node.type === "ArrayExpression";
}

export function isSpreadElement(node: Node): node is Node & { type: "SpreadElement" } {
  return node.type === "SpreadElement";
}

export function isSpreadAssignment(node: Node): node is Node & { type: "SpreadElement" } {
  return node.type === "SpreadElement";
}

export function isAsExpression(node: Node): node is Node & { type: "TSAsExpression" } {
  return node.type === "TSAsExpression";
}

export function isNonNullExpression(node: Node): node is Node & { type: "TSNonNullExpression" } {
  return node.type === "TSNonNullExpression";
}

export function isSatisfiesExpression(
  node: Node,
): node is Node & { type: "TSSatisfiesExpression" } {
  return node.type === "TSSatisfiesExpression";
}

export function isTypeAssertionExpression(node: Node): node is Node & { type: "TSTypeAssertion" } {
  return node.type === "TSTypeAssertion";
}

export function isParenthesizedExpression(
  node: Node,
): node is Node & { type: "ParenthesizedExpression" } {
  return node.type === "ParenthesizedExpression";
}

export function isJsxAttribute(node: Node): node is Node & { type: "JSXAttribute" } {
  return node.type === "JSXAttribute";
}

export function isJsxExpression(node: Node): node is Node & { type: "JSXExpressionContainer" } {
  return node.type === "JSXExpressionContainer";
}

export function isJsxOpeningElement(node: Node): node is Node & { type: "JSXOpeningElement" } {
  return node.type === "JSXOpeningElement";
}

export function isJsxSelfClosingElement(node: Node): node is Node & { type: "JSXOpeningElement" } {
  return node.type === "JSXOpeningElement" && node.selfClosing;
}

export function isIfStatement(node: Node): node is Node & { type: "IfStatement" } {
  return node.type === "IfStatement";
}

export function isConditionalExpression(
  node: Node,
): node is Node & { type: "ConditionalExpression" } {
  return node.type === "ConditionalExpression";
}

export function isTemplateExpression(node: Node): node is Node & { type: "TemplateLiteral" } {
  return node.type === "TemplateLiteral" && node.expressions.length > 0;
}

export function isPropertySignature(node: Node): node is Node & { type: "TSPropertySignature" } {
  return node.type === "TSPropertySignature";
}

export function isUnionTypeNode(node: Node): node is Node & { type: "TSUnionType" } {
  return node.type === "TSUnionType";
}

export function isLiteralTypeNode(node: Node): node is Node & { type: "TSLiteralType" } {
  return node.type === "TSLiteralType";
}

export function isPrivateIdentifier(node: Node): node is Node & { type: "PrivateIdentifier" } {
  return node.type === "PrivateIdentifier";
}

export function isExpressionStatement(node: Node): node is Node & { type: "ExpressionStatement" } {
  return node.type === "ExpressionStatement";
}

export function isStringLiteral(node: Node): node is import("oxc-parser").StringLiteral {
  return node.type === "Literal" && typeof node.value === "string";
}
export function isNumericLiteral(node: Node): node is import("oxc-parser").NumericLiteral {
  return node.type === "Literal" && typeof node.value === "number";
}
export function isNoSubstitutionTemplateLiteral(
  node: Node,
): node is import("oxc-parser").TemplateLiteral {
  return node.type === "TemplateLiteral" && node.expressions.length === 0;
}
export function isBinaryExpression(
  node: Node,
): node is
  | import("oxc-parser").BinaryExpression
  | import("oxc-parser").LogicalExpression
  | import("oxc-parser").AssignmentExpression {
  return (
    node.type === "BinaryExpression" ||
    node.type === "LogicalExpression" ||
    node.type === "AssignmentExpression"
  );
}
export function isRegularExpressionLiteral(node: Node): node is import("oxc-parser").RegExpLiteral {
  return node.type === "Literal" && "regex" in node;
}
export function isPropertyAccessExpression(
  node: Node,
): node is import("oxc-parser").MemberExpression & { computed: false } {
  return node.type === "MemberExpression" && !node.computed;
}
export function isElementAccessExpression(
  node: Node,
): node is import("oxc-parser").MemberExpression & { computed: true } {
  return node.type === "MemberExpression" && node.computed;
}
export function isComputedPropertyName(node: Node): boolean {
  const parent = parentOf(node);
  return !!parent && "computed" in parent && parent.computed;
}
export function isOmittedExpression(node: Node | null): node is null {
  return node === null;
}
export function hasModifier(
  node: Node,
  modifier: "export" | "default" | "static" | "declare",
): boolean {
  const parent = parentOf(node);
  if (modifier === "export")
    return parent?.type === "ExportNamedDeclaration" || parent?.type === "ExportDefaultDeclaration";
  if (modifier === "default") return parent?.type === "ExportDefaultDeclaration";
  return modifier in node && Reflect.get(node, modifier) === true;
}
export function topLevelDeclarations(source: SourceFile): Node[] {
  return source.body.map((statement) =>
    (statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration") &&
    statement.declaration
      ? statement.declaration
      : statement,
  );
}

export type Identifier = Node & { type: "Identifier" };
export type FunctionDeclaration = Node & { type: "FunctionDeclaration" };
export type FunctionExpression = Node & { type: "FunctionExpression" };
export function isEnumDeclaration(node: Node): node is Node & { type: "TSEnumDeclaration" } {
  return node.type === "TSEnumDeclaration";
}
