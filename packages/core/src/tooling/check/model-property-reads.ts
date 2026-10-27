import { readFileSync } from "node:fs";
import path from "node:path";
import * as ast from "../syntax/ast";
import {
  calleeName,
  isMemberAccess,
  keyName,
  memberName,
  type SourceFinding,
  unwrap,
} from "./source-ast";

// ── WL9021: a Cascade column read as a property ─────────────────────────────

/** What the check knows about one model class. */
export type ModelFact = {
  /** The class it extends, so columns and members can be inherited. */
  parent: string | undefined;
  /** Top-level keys of `static schema`, or `undefined` when it cannot be read statically. */
  columns: ReadonlySet<string> | undefined;
  /** Instance members the class declares itself (getters, methods, fields). */
  members: ReadonlySet<string>;
  /**
   * Schema columns whose value is a plain object, with the type to show
   * (`object`, `record`, `array of objects`). Only statically readable
   * `v.object` / `v.record` / `v.array(v.object(...))` columns appear.
   */
  objectColumns?: ReadonlyMap<string, string>;
};

export type ModelFacts = ReadonlyMap<string, ModelFact>;

export const EMPTY_MODEL_FACTS: ModelFacts = new Map();

/** Public instance members of `Model`, which are real properties. */
const MODEL_MEMBERS: ReadonlySet<string> = new Set([
  "id",
  "uuid",
  "data",
  "isNew",
  "isActive",
  "createdAt",
  "updatedAt",
  "dirtyTracker",
  "loadedRelations",
  "trustedPrimaryKey",
  "constructor",
]);

/** Classes that are models without being declared in the project. */
const FRAMEWORK_MODELS: ReadonlySet<string> = new Set(["Model", "Auth"]);

/** Static finders that resolve to one model instance. */
const INSTANCE_FINDERS: ReadonlySet<string> = new Set([
  "find",
  "findOrFail",
  "first",
  "firstOrFail",
  "last",
  "create",
  "findOrCreate",
  "upsert",
  "hydrate",
  "latest",
  "oldest",
]);

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

function child(node: ast.Node, key: string): ast.Node | undefined {
  const value: unknown = Reflect.get(node, key);

  return value && typeof value === "object" && "type" in value ? (value as ast.Node) : undefined;
}

function children(node: ast.Node, key: string): ast.Node[] {
  const value: unknown = Reflect.get(node, key);

  return Array.isArray(value)
    ? value.filter((item): item is ast.Node => !!item && typeof item === "object" && "type" in item)
    : [];
}

function visitAll(node: ast.Node, visit: (node: ast.Node) => void): void {
  visit(node);
  ast.forEachChild(node, (next) => visitAll(next, visit));
}

/** Keys of the object literal inside `v.object({ ... })...`, or `undefined` if not static. */
function schemaKeys(
  expression: ast.Node | undefined,
  constants: ReadonlyMap<string, ast.Node>,
  depth = 0,
): Set<string> | undefined {
  if (!expression || depth > 4) return undefined;

  let current = unwrap(expression);

  if (current.type === "Identifier") {
    const constant = constants.get(current.name);

    return schemaKeys(constant, constants, depth + 1);
  }

  // Walk down `v.object({...}).allowUnknown().stripUnknown()`.
  while (ast.isCallExpression(current)) {
    const callee = unwrap(ast.expressionOf(current));

    if (!isMemberAccess(callee)) return undefined;

    if (memberName(callee) === "object") {
      const argument = children(current, "arguments")[0];

      if (!argument || !ast.isObjectLiteralExpression(argument)) return undefined;

      const keys = new Set<string>();

      for (const property of children(argument, "properties")) {
        if (property.type !== "Property") return undefined;

        const name = keyName(child(property, "key"));

        if (name === undefined) return undefined;
        keys.add(name);
      }

      return keys;
    }

    current = unwrap(ast.expressionOf(callee));
  }

  return undefined;
}

/** The `X` of the innermost `v.X(...)` call of a validator chain, with that call. */
function validatorBase(
  expression: ast.Node | undefined,
): { type: string; call: ast.Node } | undefined {
  if (!expression) return undefined;

  let current = unwrap(expression);
  let found: { type: string; call: ast.Node } | undefined;

  while (ast.isCallExpression(current)) {
    const callee = unwrap(ast.expressionOf(current));

    if (!isMemberAccess(callee)) return found;

    const name = memberName(callee);
    const receiver = unwrap(ast.expressionOf(callee));

    if (name && receiver.type === "Identifier") found = { type: name, call: current };

    current = receiver;
  }

  return found;
}

/** `object`, `record` or `array of objects` when a column validator stores a plain object. */
function objectColumnType(expression: ast.Node | undefined): string | undefined {
  const base = validatorBase(expression);

  if (!base) return undefined;
  if (base.type === "object" || base.type === "record") return base.type;

  if (base.type === "array") {
    const item = validatorBase(children(base.call, "arguments")[0]);

    return item?.type === "object" || item?.type === "record" ? "array of objects" : undefined;
  }

  return undefined;
}

/** The `v.object({...})` literal of a `static schema`, through constants and chained calls. */
function schemaLiteral(
  expression: ast.Node | undefined,
  constants: ReadonlyMap<string, ast.Node>,
  depth = 0,
): ast.Node | undefined {
  if (!expression || depth > 4) return undefined;

  const current = unwrap(expression);

  if (current.type === "Identifier")
    return schemaLiteral(constants.get(current.name), constants, depth + 1);

  const base = validatorBase(current);

  if (base?.type !== "object") return undefined;

  const argument = children(base.call, "arguments")[0];

  return argument && ast.isObjectLiteralExpression(argument) ? argument : undefined;
}

function objectColumnsOf(
  expression: ast.Node | undefined,
  constants: ReadonlyMap<string, ast.Node>,
): Map<string, string> {
  const columns = new Map<string, string>();
  const literal = schemaLiteral(expression, constants);

  if (!literal) return columns;

  for (const property of children(literal, "properties")) {
    if (property.type !== "Property") continue;

    const name = keyName(child(property, "key"));
    const type = objectColumnType(child(property, "value"));

    if (name !== undefined && type) columns.set(name, type);
  }

  return columns;
}

function classFact(
  declaration: ast.Node,
  constants: ReadonlyMap<string, ast.Node>,
): { name: string; fact: ModelFact } | undefined {
  const name = ast.declarationName(declaration);
  const superClass = child(declaration, "superClass");

  if (!name || !superClass) return undefined;

  const parent = unwrap(superClass);

  if (parent.type !== "Identifier") return undefined;

  const members = new Set<string>();
  let columns: Set<string> | undefined;
  let objectColumns: Map<string, string> | undefined;

  for (const member of children(child(declaration, "body") ?? declaration, "body")) {
    const memberKey = keyName(child(member, "key"));

    if (memberKey === undefined) continue;

    const isStatic = Reflect.get(member, "static") === true;

    if (isStatic) {
      if (memberKey === "schema" && member.type === "PropertyDefinition") {
        columns = schemaKeys(child(member, "value"), constants);
        objectColumns = objectColumnsOf(child(member, "value"), constants);
      }

      continue;
    }

    members.add(memberKey);
  }

  return { name, fact: { parent: parent.name, columns, members, objectColumns } };
}

/** The model classes declared in one parsed file. */
export function modelFactsOf(sourceFile: ast.SourceFile): Map<string, ModelFact> {
  const constants = new Map<string, ast.Node>();
  const facts = new Map<string, ModelFact>();

  visitAll(sourceFile, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
      constants.set(node.id.name, node.init);
    }
  });

  visitAll(sourceFile, (node) => {
    if (!ast.isClassDeclaration(node)) return;

    const found = classFact(node, constants);

    if (found) facts.set(found.name, found.fact);
  });

  return facts;
}

/**
 * Gathers the model classes of `files` (project-relative). Unreadable or
 * unparsable files contribute nothing, as the per-file checks report them.
 */
export function collectModelFacts(cwd: string, files: readonly string[]): ModelFacts {
  const facts = new Map<string, ModelFact>();

  for (const file of files) {
    if (!/^src\/.*\.[cm]?[jt]sx?$/.test(file)) continue;

    try {
      const source = readFileSync(path.join(cwd, file), "utf8");

      // Cheap pre-filter: a model class extends something and declares a schema.
      if (!/\bextends\b/.test(source)) continue;

      for (const [name, fact] of modelFactsOf(ast.parseSourceFile(file, source))) {
        facts.set(name, fact);
      }
    } catch {
      continue;
    }
  }

  return facts;
}

type Resolved = {
  columns: ReadonlySet<string> | undefined;
  members: ReadonlySet<string>;
  objectColumns: ReadonlyMap<string, string>;
};

/** Resolve inheritance; `undefined` when the class is not a model. */
function resolveModel(name: string, facts: ModelFacts): Resolved | undefined {
  const members = new Set<string>(MODEL_MEMBERS);
  const columns = new Set<string>();
  const objectColumns = new Map<string, string>();
  let current: string | undefined = name;

  for (let depth = 0; depth < 10 && current !== undefined; depth++) {
    if (FRAMEWORK_MODELS.has(current) && !facts.has(current)) {
      return { columns: columns.size > 0 ? columns : undefined, members, objectColumns };
    }

    const fact = facts.get(current);

    if (!fact) return undefined;

    for (const member of fact.members) members.add(member);

    // A subclass column shadows the parent's, so only unseen columns count.
    for (const [column, type] of fact.objectColumns ?? []) {
      if (!columns.has(column)) objectColumns.set(column, type);
    }

    if (fact.columns) {
      for (const column of fact.columns) columns.add(column);
    }

    current = fact.parent;
  }

  return undefined;
}

/** `User`, `User | null`, `User | undefined`, as the model name. */
function annotatedModel(type: ast.Node | undefined): string | undefined {
  if (!type) return undefined;
  if (type.type === "TSTypeReference") {
    const typeName = child(type, "typeName");

    return typeName?.type === "Identifier" ? typeName.name : undefined;
  }
  if (type.type === "TSUnionType") {
    const names = children(type, "types")
      .filter((member) => member.type !== "TSNullKeyword" && member.type !== "TSUndefinedKeyword")
      .map((member) => annotatedModel(member));

    return names.length === 1 ? names[0] : undefined;
  }

  return undefined;
}

/** The model a value expression produces, from `new User()` or `await User.find()`. */
function producedModel(expression: ast.Node | undefined, facts: ModelFacts): string | undefined {
  if (!expression) return undefined;

  const value = unwrap(
    expression.type === "AwaitExpression" ? ast.expressionOf(expression) : expression,
  );

  if (ast.isNewExpression(value)) {
    const callee = unwrap(ast.expressionOf(value));

    return callee.type === "Identifier" && resolveModel(callee.name, facts)
      ? callee.name
      : undefined;
  }

  if (!ast.isCallExpression(value)) return undefined;

  const method = calleeName(value);

  if (!method || !INSTANCE_FINDERS.has(method)) return undefined;

  let root = unwrap(ast.expressionOf(value));

  while (isMemberAccess(root) || ast.isCallExpression(root)) {
    root = unwrap(ast.expressionOf(root));
  }

  return root.type === "Identifier" && resolveModel(root.name, facts) ? root.name : undefined;
}

/** Variables and parameters of one file that hold a model instance. */
function instanceVariables(sourceFile: ast.SourceFile, facts: ModelFacts): Map<string, string> {
  const declared = new Map<string, number>();
  const models = new Map<string, string>();

  const declare = (name: string, model: string | undefined): void => {
    declared.set(name, (declared.get(name) ?? 0) + 1);
    if (model && resolveModel(model, facts)) models.set(name, model);
  };

  visitAll(sourceFile, (node) => {
    if (node.type === "VariableDeclarator") {
      const id = node.id;

      if (id.type !== "Identifier") return;

      declare(
        id.name,
        annotatedModel(id.typeAnnotation?.typeAnnotation) ??
          producedModel(node.init ?? undefined, facts),
      );
    } else if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      for (const parameter of children(node, "params")) {
        if (parameter.type !== "Identifier") continue;

        declare(parameter.name, annotatedModel(parameter.typeAnnotation?.typeAnnotation));
      }
    }
  });

  // A name declared twice may hold different things in different scopes: skip it.
  for (const [name, count] of declared) {
    if (count > 1) models.delete(name);
  }

  return models;
}

function enclosingModel(node: ast.Node, facts: ModelFacts): string | undefined {
  for (let current = ast.parentOf(node); current; current = ast.parentOf(current)) {
    if (current.type === "MethodDefinition" && Reflect.get(current, "static") === true)
      return undefined;
    if (ast.isClassDeclaration(current)) {
      const name = ast.declarationName(current);

      return name && resolveModel(name, facts) ? name : undefined;
    }
  }

  return undefined;
}

function checkMember(
  node: ast.Node,
  receivers: ReadonlyMap<string, string>,
  facts: ModelFacts,
  sourceFile: ast.SourceFile,
  findings: SourceFinding[],
): void {
  if (!isMemberAccess(node)) return;

  const object = unwrap(node.object);
  let model: string | undefined;
  let receiver: string;

  if (object.type === "Identifier") {
    model = receivers.get(object.name);
    receiver = object.name;
  } else if (object.type === "ThisExpression") {
    model = enclosingModel(node, facts);
    receiver = "this";
  } else {
    return;
  }

  if (!model) return;

  const column = memberName(node);
  const resolved = resolveModel(model, facts);

  if (!column || !resolved?.columns?.has(column) || resolved.members.has(column)) return;

  const parent = ast.parentOf(node);
  const isCallee =
    parent && ast.isCallExpression(parent) && unwrap(ast.expressionOf(parent)) === node;

  if (isCallee) return;

  if (
    parent?.type === "UpdateExpression" ||
    (parent?.type === "UnaryExpression" && Reflect.get(parent, "operator") === "delete")
  ) {
    return;
  }

  const assignment =
    parent?.type === "AssignmentExpression" && child(parent, "left") === node ? parent : undefined;

  if (assignment) {
    const statement = ast.parentOf(assignment);
    const right = child(assignment, "right");
    const canFix =
      Reflect.get(assignment, "operator") === "=" &&
      statement?.type === "ExpressionStatement" &&
      right;

    findings.push({
      code: "WL9021",
      severity: "warning",
      node,
      message: `\`${receiver}.${column}\` writes a column as a property, so the model never sees the change. Use \`${receiver}.set("${column}", value)\`.`,
      fix: canFix
        ? {
            start: assignment.start,
            end: assignment.end,
            text: `${sourceFile.text.slice(node.object.start, node.object.end)}.set("${column}", ${sourceFile.text.slice(right.start, right.end)})`,
          }
        : undefined,
    });

    return;
  }

  const between = sourceFile.text.slice(node.object.end, node.end);
  const replaced = between.replace(/(\??\.)\s*[\w$]+$/, `$1get("${column}")`);

  findings.push({
    code: "WL9021",
    severity: "warning",
    node,
    message: `\`${receiver}.${column}\` reads a column as a property, which is undefined at runtime. Use \`${receiver}.get("${column}")\`.`,
    fix:
      node.computed || replaced === between
        ? undefined
        : { start: node.object.end, end: node.end, text: replaced },
  });
}

function receiverModel(
  object: ast.Node,
  receivers: ReadonlyMap<string, string>,
  facts: ModelFacts,
  node: ast.Node,
): string | undefined {
  const target = unwrap(object);

  if (target.type === "Identifier") return receivers.get(target.name);
  if (target.type === "ThisExpression") return enclosingModel(node, facts);

  return undefined;
}

function checkMerge(
  node: ast.Node,
  receivers: ReadonlyMap<string, string>,
  facts: ModelFacts,
  findings: SourceFinding[],
): void {
  if (!ast.isCallExpression(node)) return;

  const callee = unwrap(ast.expressionOf(node));

  if (!isMemberAccess(callee) || memberName(callee) !== "merge") return;

  const model = receiverModel(callee.object, receivers, facts, node);
  const resolved = model ? resolveModel(model, facts) : undefined;

  if (!resolved || resolved.objectColumns.size === 0) return;

  const argument = children(node, "arguments")[0];

  if (!argument || !ast.isObjectLiteralExpression(argument)) return;

  for (const property of children(argument, "properties")) {
    if (property.type !== "Property") continue;

    const key = keyName(child(property, "key"));
    const type = key === undefined ? undefined : resolved.objectColumns.get(key);

    if (key === undefined || !type) continue;

    findings.push({
      code: "WL9025",
      severity: "warning",
      node: property,
      message: `\`merge()\` deep-merges the \`${key}\` column (${type}), so keys missing from this value stay stored. Use \`set({ ${key}: ... })\` or \`set("${key}", value)\` to replace it.`,
    });
  }
}

/**
 * `WL9025` (warning): `model.merge({ column: {...} })` where the model's
 * schema declares `column` as an object, record or array-of-objects column.
 * `merge()` deep-merges plain objects, so a key left out of the new value is
 * kept in the stored one; `set()` replaces the column. No fix:
 * the two behave differently.
 *
 * Receivers resolve exactly as for `WL9021` (instances from `new`, finders,
 * annotations and `this`), and the schema must be statically readable, so a
 * `.merge()` on any other object is never flagged.
 */
export function modelMergeFindings(
  sourceFile: ast.SourceFile,
  facts: ModelFacts = EMPTY_MODEL_FACTS,
): SourceFinding[] {
  if (TEST_FILE.test(sourceFile.fileName)) return [];

  const known = new Map<string, ModelFact>(facts);

  for (const [name, fact] of modelFactsOf(sourceFile)) known.set(name, fact);

  if (known.size === 0) return [];

  const receivers = instanceVariables(sourceFile, known);
  const findings: SourceFinding[] = [];

  visitAll(sourceFile, (node) => checkMerge(node, receivers, known, findings));

  return findings;
}

/**
 * `WL9021` (warning): `model.<column>` reads and writes on a Cascade model
 * instance. Model data lives behind `get()` / `set()`; the property is always
 * `undefined`.
 *
 * Instances are recognised from `new User()`, `await User.find()` (and the
 * other single-record finders), a `User` / `User | null` annotation, and
 * `this` inside a model class. A name is compared with the model's
 * `static schema` keys when they can be read statically (an inline
 * `v.object({...})` or a constant of the same file); a model whose schema
 * cannot be resolved is not checked, because a loaded relation is also a
 * legitimate property.
 *
 * Reads carry a fix (`.get("column")`); so do plain `model.column = value;`
 * statements (`.set("column", value)`).
 */
export function modelPropertyReadFindings(
  sourceFile: ast.SourceFile,
  facts: ModelFacts = EMPTY_MODEL_FACTS,
): SourceFinding[] {
  if (TEST_FILE.test(sourceFile.fileName)) return [];

  const known = new Map<string, ModelFact>(facts);

  // Models declared in the checked file are known even without project facts.
  for (const [name, fact] of modelFactsOf(sourceFile)) known.set(name, fact);

  if (known.size === 0) return [];

  const receivers = instanceVariables(sourceFile, known);
  const findings: SourceFinding[] = [];

  visitAll(sourceFile, (node) => checkMember(node, receivers, known, sourceFile, findings));

  return findings;
}
