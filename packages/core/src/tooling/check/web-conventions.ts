import * as ast from "../syntax/ast";
import {
  ancestors,
  calleeName,
  isFunctionLike,
  keyName,
  literalString,
  memberName,
  unwrap,
  walk,
  type SourceFinding,
} from "./source-ast";

export type ConventionOptions = {
  componentLineLimit?: number;
  /** The locales every translation key must carry; default: `localeCodes` in `src/config/app.ts`. */
  localeCodes?: string[];
  rules?: Partial<
    Record<import("../../errors/error-codes").WarlockErrorCode, "off" | "warning" | "error">
  >;
};

/** JSX-returning functions are components; helpers and hook files are not. */
export function webFindings(
  source: ast.SourceFile,
  options: ConventionOptions = {},
): SourceFinding[] {
  if (!/^src\/web\/.*\.tsx$/.test(source.fileName)) return [];
  const findings: SourceFinding[] = [];
  const hooks = new Set(["useState", "useReducer", "useEffect", "useLayoutEffect"]);
  for (const statement of source.body)
    if (statement.type === "ImportDeclaration" && statement.source.value === "react") {
      for (const specifier of statement.specifiers)
        if (specifier.type === "ImportSpecifier" && hooks.has(keyName(specifier.imported) ?? ""))
          hooks.add(specifier.local.name);
    }
  const components: ast.Node[] = [];
  walk(
    source,
    (node) => {
      if (!isFunctionLike(node) || !node.body || ancestors(node).some(isFunctionLike)) return;
      const parent = ast.parentOf(node);
      const name =
        node.id?.name ?? (parent?.type === "VariableDeclarator" ? keyName(parent.id) : undefined);
      if (name && !/^[A-Z]/.test(name)) return;
      let jsx = false;
      walk(node.body, (child) => {
        if (child.type === "JSXElement" || child.type === "JSXFragment") jsx = true;
      });
      if (jsx) components.push(node);
    },
    true,
  );
  const add = (code: SourceFinding["code"], node: ast.Node, message: string) =>
    findings.push({ code, node, message, severity: "warning" });
  const limit = options.componentLineLimit ?? 150;
  if (components.length && source.text.replace(/\r?\n$/, "").split(/\r?\n/).length > limit)
    add(
      "WL9013",
      components[0] ?? source,
      `Component file exceeds ${limit} lines. Split it into smaller components and use-*.ts hooks.`,
    );
  for (const component of components.slice(1))
    add(
      "WL9014",
      component,
      "More than one component in this file. Move each component to its own file.",
    );
  for (const component of components) {
    if (!isFunctionLike(component) || !component.body) continue;
    const eventNames = new Set<string>();
    walk(component.body, (node) => {
      if (
        node.type === "JSXAttribute" &&
        /^on[A-Z]/.test(keyName(node.name) ?? "") &&
        node.value?.type === "JSXExpressionContainer" &&
        node.value.expression.type === "Identifier"
      )
        eventNames.add(node.value.expression.name);
    });
    walk(component.body, (node) => {
      if (node.type === "CallExpression" && hooks.has(calleeName(node) ?? ""))
        add("WL9015", node, "Move component state and effects to a use-*.ts hook file.");
      if (isFunctionLike(node)) {
        const parent = ast.parentOf(node);
        const name =
          node.id?.name ?? (parent?.type === "VariableDeclarator" ? keyName(parent.id) : undefined);
        const attribute =
          parent?.type === "JSXExpressionContainer" ? ast.parentOf(parent) : undefined;
        if (
          /^(?:handle|on)[A-Z]/.test(name ?? "") ||
          eventNames.has(name ?? "") ||
          (attribute?.type === "JSXAttribute" && /^on[A-Z]/.test(keyName(attribute.name) ?? ""))
        )
          add("WL9015", node, "Move this event-handler function to a use-*.ts hook file.");
      }
    });
  }
  walk(
    source,
    (node) => {
      if (node.type !== "JSXOpeningElement" || node.name.type !== "JSXIdentifier") return;
      const tag = node.name.name;
      if (!["input", "textarea", "select"].includes(tag)) return;
      const attributes = node.attributes.filter((attribute) => attribute.type === "JSXAttribute");
      const value = (attribute: ast.JSXAttribute) =>
        attribute.value?.type === "JSXExpressionContainer"
          ? literalString(attribute.value.expression)
          : literalString(attribute.value);
      const inputType = attributes.find((attribute) => keyName(attribute.name) === "type");
      const type = inputType ? value(inputType) : undefined;
      if (
        !source.fileName.startsWith("src/web/design-system/") &&
        (tag === "select" ||
          (tag === "input" &&
            ["checkbox", "radio", "date", "time", "datetime-local"].includes(type ?? "")))
      )
        add("WL9016", node, "Use a design-system control instead of this native form control.");
      for (const attribute of attributes) {
        const name = keyName(attribute.name);
        if (
          ["required", "pattern", "min", "max", "minLength", "maxLength"].includes(name ?? "") ||
          (tag === "input" && name === "type" && type === "email")
        )
          add(
            "WL9017",
            attribute,
            "Move native validation to the shared validation schema and display field errors through the design-system control.",
          );
      }
    },
    true,
  );
  return findings;
}

/** RequestHandler exports declare their contract through a static responseSchema. */
export function responseSchemaFindings(source: ast.SourceFile): SourceFinding[] {
  if (!/^src\/app\/.+\/controllers\/.+\.[cm]?tsx?$/.test(source.fileName)) return [];
  const handlerTypes = new Set(["RequestHandler"]);
  for (const statement of source.body)
    if (statement.type === "ImportDeclaration")
      for (const specifier of statement.specifiers)
        if (
          specifier.type === "ImportSpecifier" &&
          keyName(specifier.imported) === "RequestHandler"
        )
          handlerTypes.add(specifier.local.name);
  const exports = new Set<string>();
  const schemas = new Set<string>();
  const handlers: ast.VariableDeclarator[] = [];
  walk(
    source,
    (node) => {
      if (node.type === "ExportNamedDeclaration")
        for (const specifier of node.specifiers) exports.add(keyName(specifier.local) ?? "");
      if (node.type === "ExportDefaultDeclaration" && node.declaration.type === "Identifier")
        exports.add(node.declaration.name);
      if (ancestors(node).some(isFunctionLike)) return;
      if (node.type === "AssignmentExpression" && node.operator === "=") {
        const left = unwrap(node.left);
        if (
          left.type === "MemberExpression" &&
          memberName(left) === "responseSchema" &&
          left.object.type === "Identifier" &&
          !["undefined", "null"].includes(ast.textOf(node.right))
        )
          schemas.add(left.object.name);
      }
      if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier") return;
      const annotation = node.id.typeAnnotation?.typeAnnotation;
      const initializer = node.init;
      const satisfied =
        initializer?.type === "TSSatisfiesExpression" ? initializer.typeAnnotation : undefined;
      const type = annotation ?? satisfied;
      if (type?.type !== "TSTypeReference" || !handlerTypes.has(keyName(type.typeName) ?? ""))
        return;
      handlers.push(node);
      if (
        initializer?.type === "CallExpression" &&
        initializer.callee.type === "MemberExpression" &&
        initializer.callee.object.type === "Identifier" &&
        initializer.callee.object.name === "Object" &&
        keyName(initializer.callee.property) === "assign" &&
        initializer.arguments
          .slice(1)
          .some(
            (argument) =>
              argument.type === "ObjectExpression" &&
              argument.properties.some(
                (property) =>
                  property.type === "Property" && keyName(property.key) === "responseSchema",
              ),
          )
      )
        schemas.add(node.id.name);
      if (ancestors(node).some((parent) => parent.type === "ExportNamedDeclaration"))
        exports.add(node.id.name);
    },
    true,
  );
  return handlers
    .filter(
      (node) =>
        node.id.type === "Identifier" && exports.has(node.id.name) && !schemas.has(node.id.name),
    )
    .map<SourceFinding>((node) => ({
      code: "WL9018",
      node: node.id,
      severity: "warning",
      message:
        "Exported RequestHandler has no responseSchema. Declare the response body contract for each returned status code.",
    }));
}
