import type { Node, ObjectLiteralExpression } from "ts-morph";
import type { CodemodContext, CodemodOutput } from "../types";
import { OXLINT_RULE_SCHEMAS } from "./oxlint-rule-schemas";
import { isRecord, matchesSchema } from "./validate-oxlint-rule";

type OxcConfig = Record<string, unknown>;
const CHANGE = {
  line: 1,
  description: "Port custom ESLint rules to native Oxlint rules and overrides",
};

/** Parse literals, never import/execute an application's executable configuration. */
export function portEslintRules(
  context: CodemodContext,
  output: CodemodOutput,
  file: string,
  source: string,
  preserveExisting = true,
  configKey?: string,
): boolean {
  const { Node, SyntaxKind } = context.tsMorph;
  const project = new context.tsMorph.Project({ useInMemoryFileSystem: true });
  const json = file.endsWith(".json") || file === ".eslintrc";
  const parsed = project.createSourceFile(
    `${file}.ts`,
    json ? `export default ${source};` : source,
  );
  let config: OxcConfig;
  const existing = context.text.read(".oxlintrc.json");
  try {
    const value: unknown = JSON.parse(existing ?? "{}");
    if (!isRecord(value)) throw new Error("Config must be an object");
    config = value;
  } catch {
    output.manual.push({
      file,
      line: 1,
      hint: "Cannot merge rules into the existing .oxlintrc.json; review its JSON before porting this config. ESLint support is gone in 5.34.0.",
    });
    return false;
  }
  const protectedRules = isRecord(config.rules) ? { ...config.rules } : {};
  const protectedOverrides = Array.isArray(config.overrides) ? [...config.overrides] : [];
  let changed = false;
  let typeAware = false;
  const finding = (node: Node, rule: string, scope: string, reason: string) => {
    output.manual.push({
      file,
      line: node.getStartLineNumber(),
      hint: `Port ${rule} for files ${scope}: ${reason}. ESLint support is gone in 5.34.0.`,
    });
  };
  const resolve = (node: Node, seen = new Set<string>()): Node => {
    if (
      Node.isParenthesizedExpression(node) ||
      Node.isAsExpression(node) ||
      Node.isSatisfiesExpression(node)
    )
      return resolve(node.getExpression(), seen);
    if (Node.isPropertyAccessExpression(node)) {
      const marker = `property:${node.getText()}`;
      if (seen.has(marker)) throw new Error("cyclic config property");
      const next = new Set([...seen, marker]);
      const object = resolve(node.getExpression(), next);
      if (Node.isObjectLiteralExpression(object)) {
        const value = property(object, node.getName());
        if (value) return resolve(value, next);
      }
    }
    if (Node.isIdentifier(node)) {
      const name = node.getText();
      if (seen.has(name)) throw new Error(`cyclic config constant ${name}`);
      const declaration = parsed.getVariableDeclaration(name);
      const value = declaration?.getInitializer();
      if (value) return resolve(value, new Set([...seen, name]));
    }
    return node;
  };
  const literal = (input: Node, depth = 0): unknown => {
    if (depth > 30) throw new Error("cyclic or deeply nested config value");
    const node = resolve(input);
    if (
      Node.isStringLiteral(node) ||
      Node.isNoSubstitutionTemplateLiteral(node) ||
      Node.isNumericLiteral(node)
    )
      return node.getLiteralValue();
    if (node.getKind() === SyntaxKind.TrueKeyword) return true;
    if (node.getKind() === SyntaxKind.FalseKeyword) return false;
    if (node.getKind() === SyntaxKind.NullKeyword) return null;
    if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.MinusToken) {
      const value = literal(node.getOperand(), depth + 1);
      if (typeof value === "number") return -value;
    }
    if (Node.isArrayLiteralExpression(node))
      return node.getElements().flatMap((entry) => {
        if (Node.isSpreadElement(entry)) {
          const value = literal(entry.getExpression(), depth + 1);
          if (!Array.isArray(value)) throw new Error("computed array spread");
          return value;
        }
        return [literal(entry, depth + 1)];
      });
    if (Node.isObjectLiteralExpression(node)) {
      const value: Record<string, unknown> = {};
      for (const entry of node.getProperties()) {
        if (Node.isSpreadAssignment(entry)) {
          const spread = literal(entry.getExpression(), depth + 1);
          if (!isRecord(spread)) throw new Error("computed object spread");
          Object.assign(value, spread);
        } else if (Node.isPropertyAssignment(entry)) {
          const key = entry.getNameNode();
          if (Node.isComputedPropertyName(key)) throw new Error("computed property name");
          value[Node.isStringLiteral(key) ? key.getLiteralValue() : key.getText()] = literal(
            entry.getInitializerOrThrow(),
            depth + 1,
          );
        } else throw new Error("computed object member");
      }
      return value;
    }
    throw new Error(`nonliteral expression ${node.getText()}`);
  };
  const property = (block: ObjectLiteralExpression, name: string): Node | undefined => {
    for (const member of block.getProperties()) {
      if (Node.isShorthandPropertyAssignment(member) && member.getName() === name)
        return member.getNameNode();
      if (!Node.isPropertyAssignment(member)) continue;
      const key = member.getNameNode();
      if ((Node.isStringLiteral(key) ? key.getLiteralValue() : key.getText()) === name)
        return member.getInitializer();
    }
    return undefined;
  };
  const strings = (node: Node | undefined): string[] | undefined => {
    if (!node) return undefined;
    const value = literal(node);
    if (typeof value === "string") return [value];
    if (Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string"))
      return value;
    throw new Error("file patterns must be literal strings");
  };
  const severityOf = (value: unknown): "off" | "warn" | "error" | undefined =>
    value === 0 || value === "off"
      ? "off"
      : value === 1 || value === "warn"
        ? "warn"
        : value === 2 || value === "error"
          ? "error"
          : undefined;
  const mergeRules = (
    input: Node,
    rules: Record<string, unknown>,
    scope: string,
    depth = 0,
    state: {
      imports?: { severity: "warn" | "error"; node: Node };
      extensions?: Record<string, unknown>;
    } = {},
  ): void => {
    if (depth > 30) {
      finding(input, "rules", scope, "cyclic or deeply nested rule spread");
      return;
    }
    let node: Node;
    try {
      node = resolve(input);
    } catch {
      finding(input, "rules", scope, "cyclic config constant");
      return;
    }
    if (!Node.isObjectLiteralExpression(node)) {
      finding(input, "rules", scope, "the rules object is computed or imported");
      return;
    }
    for (const entry of node.getProperties()) {
      if (Node.isSpreadAssignment(entry)) {
        // Formatting is now Oxfmt's job; the generated Prettier compatibility spread has no lint rules to port.
        const formattingSpread =
          entry.getExpression().getText() === "prettierConfig.rules" &&
          parsed
            .getImportDeclarations()
            .some(
              (declaration) =>
                declaration.getModuleSpecifierValue() === "eslint-config-prettier" &&
                declaration.getDefaultImport()?.getText() === "prettierConfig",
            );
        if (!formattingSpread) mergeRules(entry.getExpression(), rules, scope, depth + 1, state);
        continue;
      }
      if (!Node.isPropertyAssignment(entry)) {
        finding(entry, entry.getText(), scope, "computed rule declaration");
        continue;
      }
      const nameNode = entry.getNameNode();
      const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
      if (name === "prettier/prettier") continue;
      let target = name.replace(/^@typescript-eslint\//, "typescript/").replace(/^eslint\//, "");
      if (target.startsWith("typescript/") && !(target in OXLINT_RULE_SCHEMAS.rules))
        target = target.slice("typescript/".length);
      if (name === "unused-imports/no-unused-vars") target = "no-unused-vars";
      if (name === "unused-imports/no-unused-imports") target = "no-unused-vars";
      const schema = OXLINT_RULE_SCHEMAS.rules[target];
      try {
        const value = literal(entry.getInitializerOrThrow(), depth + 1);
        const severity = Array.isArray(value) ? value[0] : value;
        if (name === "unused-imports/no-unused-imports") {
          const level = severityOf(severity);
          if (level === undefined || (Array.isArray(value) && value.length > 1)) {
            finding(entry, name, scope, "unsupported import rule options");
          } else if (level !== "off") state.imports = { severity: level, node: entry };
          else delete state.imports;
          continue;
        }
        if (schema === undefined && (severity === 0 || severity === "off")) continue;
        if (
          schema === undefined ||
          !matchesSchema(value, schema, OXLINT_RULE_SCHEMAS.definitions)
        ) {
          finding(
            entry,
            name,
            scope,
            schema === undefined
              ? "no native Oxlint equivalent (selectors and external plugins need a manual replacement)"
              : "these options are not supported by Oxlint 1.88.0",
          );
          continue;
        }
        if (OXLINT_RULE_SCHEMAS.typeAware.includes(target) && severity !== 0 && severity !== "off")
          typeAware = true;
        const active = severityOf(severity) !== "off";
        const previous = rules[target];
        const previousSeverity = Array.isArray(previous) ? previous[0] : previous;
        const extension =
          name.startsWith("@typescript-eslint/") && !target.startsWith("typescript/");
        if (extension && active) {
          state.extensions ??= {};
          state.extensions[target] = value;
        } else if (extension && previous !== undefined && severityOf(previousSeverity) !== "off")
          continue;
        else if (state.extensions && target in state.extensions) {
          if (active && JSON.stringify(state.extensions[target]) !== JSON.stringify(value))
            finding(
              entry,
              name,
              scope,
              "Oxlint unifies this base rule with its TypeScript extension; the TypeScript options were kept",
            );
          continue;
        }
        rules[target] = value;
      } catch (error) {
        finding(entry, name, scope, error instanceof Error ? error.message : "computed options");
      }
    }
    const imports = state.imports;
    if (depth === 0 && imports) {
      const previous = rules["no-unused-vars"];
      const options = Array.isArray(previous) && isRecord(previous[1]) ? previous[1] : {};
      // Native no-unused-vars covers imports and variables together. Preserve variable options,
      // and enable the safe import fix without enabling dangerous variable removal.
      const severity = severityOf(Array.isArray(previous) ? previous[0] : previous);
      const level = severity === "error" || imports.severity === "error" ? "error" : "warn";
      rules["no-unused-vars"] = [
        level,
        { ...options, fix: { imports: "safe-fix", variables: "off" } },
      ];
      if (severity !== undefined && severity !== "off" && severity !== imports.severity) {
        finding(
          imports.node,
          "unused-imports/no-unused-imports",
          scope,
          "Oxlint shares no-unused-vars severity for imports and variables; the migrated rule uses the stronger severity, review if separate severities are required",
        );
      }
    }
  };
  const visited = new Set<Node>();
  const visit = (input: Node): void => {
    let node: Node;
    try {
      node = resolve(input);
    } catch (error) {
      finding(input, "config", "**/*", error instanceof Error ? error.message : "computed config");
      return;
    }
    if (visited.has(node)) {
      finding(input, "config", "**/*", "cyclic or repeated config reference");
      return;
    }
    visited.add(node);
    if (Node.isArrayLiteralExpression(node)) {
      for (const entry of node.getElements())
        visit(Node.isSpreadElement(entry) ? entry.getExpression() : entry);
      return;
    }
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      const combiner = parsed.getImportDeclarations().some((declaration) => {
        const module = declaration.getModuleSpecifierValue();
        if (module === "eslint/config" && Node.isIdentifier(callee))
          return declaration
            .getNamedImports()
            .some(
              (specifier) =>
                specifier.getName() === "defineConfig" &&
                (specifier.getAliasNode()?.getText() ?? specifier.getName()) === callee.getText(),
            );
        return (
          module === "typescript-eslint" &&
          Node.isPropertyAccessExpression(callee) &&
          callee.getName() === "config" &&
          (declaration.getDefaultImport()?.getText() ??
            declaration.getNamespaceImport()?.getText()) === callee.getExpression().getText()
        );
      });
      if (combiner) {
        for (const argument of node.getArguments())
          visit(Node.isSpreadElement(argument) ? argument.getExpression() : argument);
        return;
      }
    }
    if (!Node.isObjectLiteralExpression(node)) {
      finding(input, "config", "**/*", "computed/imported config cannot be evaluated safely");
      return;
    }
    let files: string[] | undefined;
    let excludes: string[] | undefined;
    try {
      files = strings(property(node, "files"));
      excludes = strings(property(node, "ignores") ?? property(node, "excludedFiles"));
    } catch {
      finding(
        node,
        "config",
        "computed files",
        "review file/ignore patterns before porting its rules",
      );
      return;
    }
    const scope = (files ?? ["**/*"]).join(", ");
    const rules: Record<string, unknown> = {};
    const ruleNode = property(node, "rules");
    if (ruleNode) mergeRules(ruleNode, rules, scope);
    const portable: Record<string, unknown> = {};
    const setting = (name: "globals" | "env", settingNode: Node | undefined) => {
      if (!settingNode) return;
      try {
        let value = literal(settingNode);
        if (name === "globals" && isRecord(value))
          value = Object.fromEntries(
            Object.entries(value).map(([key, state]) => [
              key,
              state === true || state === "writeable"
                ? "writable"
                : state === false || state === "readable"
                  ? "readonly"
                  : state,
            ]),
          );
        const schema = OXLINT_RULE_SCHEMAS.config[name];
        if (schema === undefined || !matchesSchema(value, schema, OXLINT_RULE_SCHEMAS.definitions))
          throw new Error("unsupported options");
        portable[name] = value;
      } catch {
        finding(settingNode, name, scope, "computed or unsupported global/environment settings");
      }
    };
    setting("env", property(node, "env"));
    setting("globals", property(node, "globals"));
    const languageOptions = property(node, "languageOptions");
    if (languageOptions) {
      const language = resolve(languageOptions);
      if (Node.isObjectLiteralExpression(language))
        setting("globals", property(language, "globals"));
      else finding(languageOptions, "languageOptions", scope, "computed language settings");
    }
    const nestedOverrides: Node[] = [];
    for (const member of node.getProperties()) {
      if (Node.isSpreadAssignment(member))
        finding(member, "config spread", scope, "review inherited settings and rules");
      else if (
        Node.isPropertyAssignment(member) &&
        ["extends", "settings", "processor", "overrides", "linterOptions"].includes(
          member.getName().replace(/^["']|["']$/g, ""),
        )
      ) {
        if (member.getName().replace(/^["']|["']$/g, "") === "overrides") {
          const nested = member.getInitializer();
          if (nested) nestedOverrides.push(nested);
        } else
          finding(
            member,
            member.getName(),
            scope,
            "review settings that have no direct native rule mapping",
          );
      }
    }
    if (excludes && !ruleNode && !files) {
      const patterns = Array.isArray(config.ignorePatterns) ? config.ignorePatterns : [];
      config.ignorePatterns = [...new Set([...patterns, ...excludes])];
      changed = true;
    }
    if (preserveExisting) {
      for (const [name, value] of Object.entries(rules)) {
        const rootConflict =
          !files &&
          name in protectedRules &&
          JSON.stringify(protectedRules[name]) !== JSON.stringify(value);
        const overrideConflict = protectedOverrides.some(
          (entry) =>
            isRecord(entry) &&
            isRecord(entry.rules) &&
            (!files || JSON.stringify(entry.files) === JSON.stringify(files)) &&
            name in entry.rules &&
            JSON.stringify(entry.rules[name]) !== JSON.stringify(value),
        );
        if (rootConflict || overrideConflict) {
          finding(
            ruleNode ?? node,
            name,
            scope,
            "the existing Oxlint rule conflicts; kept its current value",
          );
          delete rules[name];
        }
      }
    }
    if (Object.keys(rules).length === 0 && Object.keys(portable).length === 0) {
      for (const nested of nestedOverrides) visit(nested);
      return;
    }
    if (files || excludes || Array.isArray(config.overrides)) {
      const overrides = Array.isArray(config.overrides) ? config.overrides : [];
      const override = {
        files: files ?? ["**/*"],
        ...(excludes ? { excludeFiles: excludes } : {}),
        ...portable,
        rules,
      };
      if (!overrides.some((value) => JSON.stringify(value) === JSON.stringify(override))) {
        config.overrides = [...overrides, override];
        changed = true;
      }
    } else {
      const current = isRecord(config.rules) ? config.rules : {};
      for (const [name, value] of Object.entries(rules)) {
        if (
          name in current &&
          JSON.stringify(current[name]) !== JSON.stringify(value) &&
          preserveExisting
        ) {
          finding(
            ruleNode ?? node,
            name,
            scope,
            "the existing Oxlint rule conflicts; kept its current value",
          );
        } else if (JSON.stringify(current[name]) !== JSON.stringify(value)) {
          current[name] = value;
          changed = true;
        }
      }
      config.rules = current;
      for (const [name, value] of Object.entries(portable)) {
        const previous = isRecord(config[name]) ? config[name] : {};
        if (isRecord(previous) && isRecord(value)) {
          for (const [key, state] of Object.entries(value)) {
            if (preserveExisting && key in previous && previous[key] !== state)
              finding(node, `${name}.${key}`, scope, "existing Oxc value conflicts and was kept");
            else if (previous[key] !== state) {
              previous[key] = state;
              changed = true;
            }
          }
          config[name] = previous;
        }
      }
    }
    for (const nested of nestedOverrides) visit(nested);
  };
  let exported: Node | undefined =
    parsed.getExportAssignments()[0]?.getExpression() ??
    parsed
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .find((entry) => entry.getLeft().getText() === "module.exports")
      ?.getRight();
  if (configKey && exported && Node.isObjectLiteralExpression(exported))
    exported = property(exported, configKey);
  if (exported) visit(exported);
  else finding(parsed, "config", "**/*", "no literal exported config was found");
  if (changed) {
    config.plugins = [
      ...new Set([...(Array.isArray(config.plugins) ? config.plugins : []), "typescript"]),
    ];
    if (typeAware)
      config.options = { ...(isRecord(config.options) ? config.options : {}), typeAware: true };
    context.text.write(".oxlintrc.json", `${JSON.stringify(config, null, 2)}\n`, CHANGE);
  }
  return typeAware;
}
