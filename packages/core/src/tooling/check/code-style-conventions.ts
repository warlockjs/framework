import * as ast from "../syntax/ast";
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

function checkAwaitLog(node: ast.Node, findings: SourceFinding[]): void {
  if (!ast.isAwaitExpression(node)) return;

  const argument = unwrap(ast.expressionOf(node));

  if (!ast.isCallExpression(argument)) return;

  const callee = unwrap(ast.expressionOf(argument));

  if (!isMemberAccess(callee)) return;

  const owner = unwrap(ast.expressionOf(callee));

  if (!ast.isIdentifier(owner) || !AWAITED_LOGGER_NAMES.has(ast.valueText(owner))) return;

  const method = memberName(callee);

  if (!method || !SYNC_LOG_METHODS.has(method)) return;

  findings.push({
    code: "WL9010",
    severity: "warning",
    node,
    message: `\`${ast.valueText(owner)}.${method}()\` returns the logger synchronously; \`await\` does nothing here. Remove it (use \`await log.flush()\` to wait for delivery).`,
  });
}

// ── WL9011: more than one controller in a file ──────────────────────────────

/** Handler type annotations that mark a constant as a controller. */
const HANDLER_TYPE_PATTERN = /RequestHandler$/;

const CONTROLLER_NAME_PATTERN = /Controller$/;

function hasHandlerType(declaration: ast.VariableDeclarator): boolean {
  const type = declaration.id.typeAnnotation?.typeAnnotation;
  return (
    type?.type === "TSTypeReference" &&
    type.typeName.type === "Identifier" &&
    HANDLER_TYPE_PATTERN.test(type.typeName.name)
  );
}

function controllerIdentifiers(statement: ast.Node): ast.Identifier[] {
  if (ast.isFunctionDeclaration(statement) || ast.isClassDeclaration(statement)) {
    return statement.id && CONTROLLER_NAME_PATTERN.test(statement.id.name) ? [statement.id] : [];
  }

  if (!ast.isVariableStatement(statement)) return [];

  const found: ast.Identifier[] = [];

  for (const declaration of statement.declarations) {
    if (!ast.isIdentifier(declaration.id)) continue;

    if (
      CONTROLLER_NAME_PATTERN.test(ast.valueText(declaration.id)) ||
      hasHandlerType(declaration)
    ) {
      found.push(declaration.id);
    }
  }

  return found;
}

function ordinal(position: number): string {
  if (position === 2) return "2nd";
  if (position === 3) return "3rd";

  return `${position}th`;
}

function checkOneControllerPerFile(sourceFile: ast.SourceFile, findings: SourceFinding[]): void {
  const controllers = ast
    .topLevelDeclarations(sourceFile)
    .flatMap((node) => controllerIdentifiers(node));
  const first = controllers[0];

  if (!first) return;

  controllers.slice(1).forEach((identifier, index) => {
    findings.push({
      code: "WL9011",
      severity: "warning",
      node: identifier,
      message: `\`${ast.valueText(identifier)}\` is the ${ordinal(index + 2)} controller in this file (after \`${ast.valueText(first)}\`). Move it to its own \`*.controller.ts\` file.`,
    });
  });
}

// ── WL9012: a union discriminator named `kind` ──────────────────────────────

/** A string/number literal type, or a union made only of them. */
function isLiteralType(node: ast.Node | undefined): boolean {
  if (!node) return false;
  if (ast.isLiteralTypeNode(node)) return true;

  return ast.isUnionTypeNode(node) && node.types.every((member) => ast.isLiteralTypeNode(member));
}

function checkKindDiscriminator(node: ast.Node, findings: SourceFinding[]): void {
  if (!ast.isPropertySignature(node) || ast.isComputedPropertyName(ast.nameNode(node))) return;
  if (keyName(ast.nameNode(node)) !== "kind" || !isLiteralType(node.typeAnnotation?.typeAnnotation))
    return;

  findings.push({
    code: "WL9012",
    severity: "warning",
    node: ast.nameNode(node),
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
export function codeStyleFindings(sourceFile: ast.SourceFile): SourceFinding[] {
  const findings: SourceFinding[] = [];

  checkOneControllerPerFile(sourceFile, findings);

  // Every node, type nodes included: discriminators live in type literals and interfaces.
  const visit = (node: ast.Node): void => {
    checkAwaitLog(node, findings);
    checkKindDiscriminator(node, findings);
    ast.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
}
