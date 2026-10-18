import ts from "typescript";
import type { WarlockErrorCode } from "../../errors/error-codes";

/**
 * Syntax helpers for the source convention checks (`WL9005`–`WL9012`).
 *
 * The checks read one file at a time with `ts.createSourceFile` — no program,
 * no type checker — so they stay as fast as a parse and run the same whatever
 * linter the app uses. Identifiers are resolved to their declarations by
 * walking the enclosing scopes of the syntax tree.
 */

/** One problem a source check found, before it is placed and turned into a problem. */
export type SourceFinding = {
  code: WarlockErrorCode;
  /** The node the problem is reported at. */
  node: ts.Node;
  message: string;
  /** Default `error`. */
  severity?: "error" | "warning";
};

/** `a.b` or `a["b"]`. */
export type MemberAccess = ts.PropertyAccessExpression | ts.ElementAccessExpression;

/** Whether a node is `a.b` or `a[b]`. */
export function isMemberAccess(node: ts.Node): node is MemberAccess {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

/** Strip parentheses and type-only wrappers (`x as T`, `x!`, `<T>x`, `x satisfies T`). */
export function unwrap(node: ts.Node): ts.Node {
  let current = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

/** The text of a string literal or a template without substitutions. */
export function literalString(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;

  const value = unwrap(node);

  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : undefined;
}

/** The static name of a member (`a.b` → `b`, `a["b"]` → `b`). */
export function memberName(node: MemberAccess): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;

  return literalString(node.argumentExpression);
}

/** The static name of an object-literal or type-member key (`{ a: 1 }`, `{ "a": 1 }`). */
export function keyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }

  return undefined;
}

/**
 * The name a call is made through: `foo()` → `foo`, `a.b.foo()` → `foo`.
 * Used to recognise helpers by name wherever they are imported from.
 */
export function calleeName(call: ts.CallExpression | ts.NewExpression): string | undefined {
  const callee = unwrap(call.expression);

  if (ts.isIdentifier(callee)) return callee.text;
  if (isMemberAccess(callee)) return memberName(callee);

  return undefined;
}

/** The root identifier of a member chain: `a.b.c()` → `a`. */
export function rootIdentifier(node: ts.Node): ts.Identifier | undefined {
  let current = unwrap(node);

  for (;;) {
    if (ts.isIdentifier(current)) return current;

    if (isMemberAccess(current) || ts.isCallExpression(current)) {
      current = unwrap(current.expression);
      continue;
    }

    return undefined;
  }
}

/** Whether a node is a function body owner (declaration, expression, arrow, method, accessor). */
export function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/**
 * Walk a node depth-first, skipping type annotations. The visitor returns
 * `false` to skip a node's children. Nested functions are not entered unless
 * `enterFunctions`.
 */
export function walk(
  node: ts.Node,
  visit: (node: ts.Node) => boolean | void,
  enterFunctions = false,
): void {
  if (visit(node) === false) return;
  if (!enterFunctions && isFunctionLike(node)) return;

  ts.forEachChild(node, (child) => {
    if (!ts.isTypeNode(child)) walk(child, visit, enterFunctions);

    return undefined;
  });
}

/** Every ancestor of a node, nearest first. */
export function ancestors(node: ts.Node): ts.Node[] {
  const list: ts.Node[] = [];
  let current = node.parent;

  while (current) {
    list.push(current);
    current = current.parent;
  }

  return list;
}

/**
 * Whether an identifier is a value reference: not the `b` of `a.b`, an object
 * key, or the name a declaration introduces.
 */
export function isValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;

  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === identifier;
  if (ts.isShorthandPropertyAssignment(parent)) return true;

  if (
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isEnumMember(parent)
  ) {
    return parent.name !== identifier;
  }

  if (ts.isBindingElement(parent)) {
    return parent.name !== identifier && parent.propertyName !== identifier;
  }

  return !(
    ts.isJsxAttribute(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent)
  );
}

/** What declares a name: a single `const`/`let`/`var` declarator, or something else. */
type Declaration = ts.VariableDeclaration | "other";

function declarationListDeclares(
  list: ts.VariableDeclarationList,
  name: string,
): Declaration | undefined {
  for (const declaration of list.declarations) {
    if (ts.isIdentifier(declaration.name)) {
      if (declaration.name.text === name) return declaration;
    } else if (bindingDeclares(declaration.name, name)) {
      return "other";
    }
  }

  return undefined;
}

function bindingDeclares(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;

  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingDeclares(element.name, name),
  );
}

function statementsDeclare(
  statements: readonly ts.Statement[],
  name: string,
): Declaration | undefined {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      const found = declarationListDeclares(statement.declarationList, name);
      if (found) return found;
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return "other";
    } else if (ts.isImportDeclaration(statement) && importDeclares(statement, name)) {
      return "other";
    }
  }

  return undefined;
}

function importDeclares(statement: ts.ImportDeclaration, name: string): boolean {
  const clause = statement.importClause;

  if (!clause) return false;
  if (clause.name?.text === name) return true;

  const bindings = clause.namedBindings;

  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return bindings.name.text === name;

  return bindings.elements.some((element) => element.name.text === name);
}

/** The declaration a scope node introduces for `name`, if it introduces one. */
function scopeDeclares(scope: ts.Node, name: string): Declaration | undefined {
  if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)) {
    return statementsDeclare(scope.statements, name);
  }

  if (ts.isCaseBlock(scope)) {
    for (const clause of scope.clauses) {
      const found = statementsDeclare(clause.statements, name);
      if (found) return found;
    }

    return undefined;
  }

  if (isFunctionLike(scope)) {
    if (scope.parameters.some((parameter) => bindingDeclares(parameter.name, name))) {
      return "other";
    }

    return ts.isFunctionExpression(scope) && scope.name?.text === name ? "other" : undefined;
  }

  if (
    (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    return declarationListDeclares(scope.initializer, name) ? "other" : undefined;
  }

  if (ts.isCatchClause(scope) && scope.variableDeclaration) {
    return bindingDeclares(scope.variableDeclaration.name, name) ? "other" : undefined;
  }

  return undefined;
}

/** The nearest declaration of an identifier's name, searching outward from it. */
export function findDeclaration(identifier: ts.Identifier): Declaration | undefined {
  for (const scope of ancestors(identifier)) {
    const found = scopeDeclares(scope, identifier.text);
    if (found) return found;
  }

  return undefined;
}

const ASSIGNMENT_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Whether a `let`/`var` is assigned again anywhere it is visible. */
function isReassigned(declaration: ts.VariableDeclaration): boolean {
  const name = declaration.name;

  if (!ts.isIdentifier(name)) return true;

  let reassigned = false;

  walk(
    declaration.getSourceFile(),
    (node) => {
      if (reassigned) return false;

      let target: ts.Node | undefined;

      if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
        target = unwrap(node.left);
      } else if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        target = unwrap(node.operand);
      }

      if (
        target &&
        ts.isIdentifier(target) &&
        target.text === name.text &&
        findDeclaration(target) === declaration
      ) {
        reassigned = true;
      }

      return undefined;
    },
    true,
  );

  return reassigned;
}

/**
 * The expression an identifier was initialised with, when it names a
 * `const` (or a `let`/`var` never assigned again) declared once.
 */
export function resolveInitializer(identifier: ts.Identifier): ts.Expression | undefined {
  const declaration = findDeclaration(identifier);

  if (!declaration || declaration === "other" || !declaration.initializer) return undefined;

  const list = declaration.parent;
  const isConst = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;

  if (!isConst && isReassigned(declaration)) return undefined;

  return declaration.initializer;
}

/** Every value reference to a variable declaration in its file (not the declaration itself). */
export function referencesOf(declaration: ts.VariableDeclaration): ts.Identifier[] {
  const name = declaration.name;

  if (!ts.isIdentifier(name)) return [];

  const found: ts.Identifier[] = [];

  walk(
    declaration.getSourceFile(),
    (node) => {
      if (
        ts.isIdentifier(node) &&
        node !== name &&
        node.text === name.text &&
        isValueReference(node) &&
        findDeclaration(node) === declaration
      ) {
        found.push(node);
      }

      return undefined;
    },
    true,
  );

  return found;
}

/** 1-based line and column of a node's first character. */
export function positionOf(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

  return { line: position.line + 1, column: position.character + 1 };
}
