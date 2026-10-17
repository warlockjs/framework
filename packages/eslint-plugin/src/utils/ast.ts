import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";

/** A node as ESLint hands it to listeners: an ESTree node with its parent. */
export type AnyNode = ESTree.Node & { parent?: AnyNode | null };

/** Documentation home of every rule. */
export const DOCS_BASE_URL = "https://warlock.js.org/v/latest/eslint-plugin/rules/";

/** The documentation URL of one rule. */
export function docsUrl(ruleName: string): string {
  return `${DOCS_BASE_URL}${ruleName}/`;
}

/** The parent of a node, or `undefined` at the program root. */
export function parentOf(node: AnyNode): AnyNode | undefined {
  return node.parent ?? undefined;
}

/** Widen ESLint's listener node to the parent-aware node type. */
export function asNode(node: Rule.Node | ESTree.Node): AnyNode {
  return node as AnyNode;
}

/** The static name of a member property (`a.b` → `b`, `a["b"]` → `b`). */
export function propertyName(member: ESTree.MemberExpression): string | undefined {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.property.type === "Literal" && typeof member.property.value === "string") {
    return member.property.value;
  }
  return undefined;
}

/** The static key of an object property (`{ a: 1 }`, `{ "a": 1 }`). */
export function objectKeyName(property: ESTree.Property): string | undefined {
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return undefined;
}

/**
 * The name a call is made through: `foo()` → `foo`, `a.b.foo()` → `foo`.
 * Used to recognise helpers by name wherever they are imported from.
 */
export function calleeName(call: ESTree.CallExpression | ESTree.NewExpression): string | undefined {
  const callee = call.callee;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") return propertyName(callee);
  return undefined;
}

/** The root identifier of a member chain: `a.b.c()` → `a`. */
export function rootIdentifier(node: ESTree.Node): ESTree.Identifier | undefined {
  let current: ESTree.Node = node;

  for (;;) {
    if (current.type === "Identifier") return current;
    if (current.type === "MemberExpression") {
      current = current.object;
      continue;
    }
    if (current.type === "CallExpression") {
      current = current.callee;
      continue;
    }
    if (current.type === "ChainExpression") {
      current = current.expression;
      continue;
    }
    return undefined;
  }
}

/** Unwrap TypeScript-only expression wrappers (`x as T`, `x!`, `<T>x`, `x satisfies T`). */
export function unwrapExpression(node: ESTree.Node): ESTree.Node {
  let current: ESTree.Node = node;

  for (;;) {
    const type = current.type as string;
    if (
      type !== "TSAsExpression" &&
      type !== "TSNonNullExpression" &&
      type !== "TSTypeAssertion" &&
      type !== "TSSatisfiesExpression" &&
      type !== "ChainExpression"
    ) {
      return current;
    }
    const inner = (current as { expression?: unknown }).expression;
    if (!isNodeLike(inner)) return current;
    current = inner;
  }
}

/** Whether a node is a function (declaration, expression or arrow). */
export function isFunctionNode(
  node: ESTree.Node,
): node is ESTree.FunctionDeclaration | ESTree.FunctionExpression | ESTree.ArrowFunctionExpression {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

/** Child nodes of `node`, skipping the `parent` back-reference and location data. */
export function childNodes(node: ESTree.Node): ESTree.Node[] {
  const children: ESTree.Node[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "loc" || key === "range" || key === "leadingComments") continue;
    if (key === "trailingComments" || key === "typeAnnotation" || key === "typeArguments") continue;
    if (key === "typeParameters" || key === "returnType") continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNodeLike(item)) children.push(item);
      }
    } else if (isNodeLike(value)) {
      children.push(value);
    }
  }

  return children;
}

function isNodeLike(value: unknown): value is ESTree.Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * Walk an expression depth-first. The visitor returns `false` to skip a
 * node's children. Nested functions are not entered unless `enterFunctions`.
 */
export function walk(
  node: ESTree.Node,
  visit: (node: ESTree.Node) => boolean | void,
  enterFunctions = false,
): void {
  if (visit(node) === false) return;
  if (!enterFunctions && isFunctionNode(node)) return;

  for (const child of childNodes(node)) {
    walk(child, visit, enterFunctions);
  }
}

/** Every ancestor of a node, nearest first. */
export function ancestors(node: AnyNode): AnyNode[] {
  const list: AnyNode[] = [];
  let current = parentOf(node);

  while (current) {
    list.push(current);
    current = parentOf(current);
  }

  return list;
}

/**
 * Resolve an identifier to the expression it was initialised with, when it is
 * a `const`/`let` declared once and never reassigned in the file.
 */
export function resolveInitializer(
  context: Rule.RuleContext,
  identifier: ESTree.Identifier,
): ESTree.Expression | undefined {
  const variable = findVariable(context, identifier);
  if (!variable) return undefined;
  if (variable.defs.length !== 1) return undefined;

  const definition = variable.defs[0];
  if (!definition || definition.type !== "Variable") return undefined;

  const declarator = definition.node;
  if (declarator.id.type !== "Identifier" || !declarator.init) return undefined;

  const writes = variable.references.filter((reference) => reference.isWrite());
  if (writes.length > 1) return undefined;

  return declarator.init;
}

/** Find the variable an identifier refers to, searching outward from its scope. */
export function findVariable(
  context: Rule.RuleContext,
  identifier: ESTree.Identifier,
): Scope.Variable | undefined {
  const sourceCode = context.sourceCode;
  let scope: Scope.Scope | null = sourceCode.getScope(identifier);

  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }

  return undefined;
}
