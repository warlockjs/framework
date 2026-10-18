import ts from "typescript";
import { isMemberAccess, keyName, memberName, type SourceFinding, unwrap } from "./source-ast";

// ── WL9010: await on a synchronous log call ─────────────────────────────────

const AWAITED_LOGGER_NAMES: ReadonlySet<string> = new Set(["log", "logger"]);

/** Logger methods that return the logger synchronously since 5.30. */
const SYNC_LOG_METHODS: ReadonlySet<string> = new Set([
  "info",
  "warn",
  "error",
  "debug",
  "success",
  "fatal",
  "log",
  "assert",
]);

function checkAwaitLog(node: ts.Node, findings: SourceFinding[]): void {
  if (!ts.isAwaitExpression(node)) return;

  const argument = unwrap(node.expression);

  if (!ts.isCallExpression(argument)) return;

  const callee = unwrap(argument.expression);

  if (!isMemberAccess(callee)) return;

  const owner = unwrap(callee.expression);

  if (!ts.isIdentifier(owner) || !AWAITED_LOGGER_NAMES.has(owner.text)) return;

  const method = memberName(callee);

  if (!method || !SYNC_LOG_METHODS.has(method)) return;

  findings.push({
    code: "WL9010",
    severity: "warning",
    node,
    message: `\`${owner.text}.${method}()\` returns the logger synchronously; \`await\` does nothing here. Remove it (use \`await log.flush()\` to wait for delivery).`,
  });
}

// ── WL9011: more than one controller in a file ──────────────────────────────

/** Handler type annotations that mark a constant as a controller. */
const HANDLER_TYPE_PATTERN = /RequestHandler$/;

const CONTROLLER_NAME_PATTERN = /Controller$/;

function hasHandlerType(declaration: ts.VariableDeclaration): boolean {
  const type = declaration.type;

  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    HANDLER_TYPE_PATTERN.test(type.typeName.text)
  );
}

function controllerIdentifiers(statement: ts.Statement): ts.Identifier[] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name && CONTROLLER_NAME_PATTERN.test(statement.name.text)
      ? [statement.name]
      : [];
  }

  if (!ts.isVariableStatement(statement)) return [];

  const found: ts.Identifier[] = [];

  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;

    if (CONTROLLER_NAME_PATTERN.test(declaration.name.text) || hasHandlerType(declaration)) {
      found.push(declaration.name);
    }
  }

  return found;
}

function ordinal(position: number): string {
  if (position === 2) return "2nd";
  if (position === 3) return "3rd";

  return `${position}th`;
}

function checkOneControllerPerFile(sourceFile: ts.SourceFile, findings: SourceFinding[]): void {
  const controllers = sourceFile.statements.flatMap(controllerIdentifiers);
  const first = controllers[0];

  if (!first) return;

  controllers.slice(1).forEach((identifier, index) => {
    findings.push({
      code: "WL9011",
      severity: "warning",
      node: identifier,
      message: `\`${identifier.text}\` is the ${ordinal(index + 2)} controller in this file (after \`${first.text}\`). Move it to its own \`*.controller.ts\` file.`,
    });
  });
}

// ── WL9012: a union discriminator named `kind` ──────────────────────────────

/** A string/number literal type, or a union made only of them. */
function isLiteralType(node: ts.TypeNode | undefined): boolean {
  if (!node) return false;
  if (ts.isLiteralTypeNode(node)) return true;

  return ts.isUnionTypeNode(node) && node.types.every((member) => ts.isLiteralTypeNode(member));
}

function checkKindDiscriminator(node: ts.Node, findings: SourceFinding[]): void {
  if (!ts.isPropertySignature(node) || ts.isComputedPropertyName(node.name)) return;
  if (keyName(node.name) !== "kind" || !isLiteralType(node.type)) return;

  findings.push({
    code: "WL9012",
    severity: "warning",
    node: node.name,
    message:
      "Name this discriminator `type`, not `kind` (the framework's convention for tagged unions).",
  });
}

/**
 * The code-style conventions in one parsed file, all reported as warnings:
 *
 * - `WL9010` `await` on a synchronous `log.*()` call;
 * - `WL9011` a second (third, …) controller in one file;
 * - `WL9012` a tagged union whose discriminator is `kind` instead of `type`.
 */
export function codeStyleFindings(sourceFile: ts.SourceFile): SourceFinding[] {
  const findings: SourceFinding[] = [];

  checkOneControllerPerFile(sourceFile, findings);

  // Every node, type nodes included: discriminators live in type literals and interfaces.
  const visit = (node: ts.Node): void => {
    checkAwaitLog(node, findings);
    checkKindDiscriminator(node, findings);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
}
