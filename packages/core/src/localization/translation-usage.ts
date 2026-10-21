import * as ast from "../tooling/syntax/ast";

/**
 * What one page (or one module) can look up in the translation table, derived
 * from static source. Consumers decide what to ship; this type only says which
 * keys a client render may ask for.
 *
 * - `keys` are exact keys. A key also delivers its whole subtree, so a declared
 *   group (`"members"`) and a literal leaf (`"members.title"`) use one matching
 *   rule.
 * - `prefixes` come from template keys with a static prefix
 *   (`` trans(`statuses.${status}`) `` gives `"statuses."`). Every key that
 *   starts with one is reachable.
 * - `dynamic` is set when a lookup key cannot be known before render. The
 *   consumer must then assume every key is reachable.
 */
export type TranslationUsage = {
  readonly keys: readonly string[];
  readonly prefixes: readonly string[];
  readonly dynamic: boolean;
  /** Where each unresolvable lookup was written, for diagnostics. */
  readonly dynamicSites: readonly TranslationDynamicSite[];
};

export type TranslationDynamicSite = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** The source text of the lookup's key argument, as written. */
  readonly text: string;
};

/** What one source file contributes: its own usage plus the modules it loads at run time. */
export type TranslationSourceScan = {
  readonly usage: TranslationUsage;
  /** Specifiers of value imports, re-exports and dynamic `import()` calls. */
  readonly imports: readonly string[];
};

/** The translator functions every framework and application spelling resolves to, with the key's argument index. */
const TRANSLATOR_KEY_ARGUMENT: Readonly<Record<string, number>> = Object.freeze({
  trans: 0,
  t: 0,
  transX: 0,
  transFrom: 1,
});

/** Factories that return a translator bound to the current request or page. */
const TRANSLATOR_FACTORIES = new Set(["useTrans"]);

/** Parent node types in which a bare translator identifier is handed on as a value. */
const VALUE_POSITIONS = new Set([
  "CallExpression",
  "NewExpression",
  "JSXExpressionContainer",
  "Property",
  "ArrayExpression",
  "ReturnStatement",
  "AssignmentExpression",
  "VariableDeclarator",
  "ArrowFunctionExpression",
  "ConditionalExpression",
  "LogicalExpression",
  "SpreadElement",
]);

/** Build a usage value from parts, deduplicated and frozen. */
export function usageOf(parts: {
  readonly keys?: readonly string[];
  readonly prefixes?: readonly string[];
  readonly dynamic?: boolean;
  readonly dynamicSites?: readonly TranslationDynamicSite[];
}): TranslationUsage {
  return Object.freeze({
    keys: Object.freeze([...new Set(parts.keys ?? [])]),
    prefixes: Object.freeze([...new Set(parts.prefixes ?? [])]),
    dynamic: parts.dynamic === true,
    dynamicSites: Object.freeze([...(parts.dynamicSites ?? [])]),
  });
}

export const EMPTY_TRANSLATION_USAGE: TranslationUsage = usageOf({});

/**
 * Turn one `config.translations` entry into the usage it declares.
 *
 * `"statuses.*"` declares every key under `statuses.`, `"members"` declares a
 * key and its subtree, and `"*"` declares everything. A wildcard anywhere but
 * the final `.*`, or an empty entry, is refused rather than guessed at.
 */
export function translationDeclarationUsage(entry: string, file: string): TranslationUsage {
  const invalid = (): Error =>
    new Error(
      `config.translations entry ${JSON.stringify(entry)} in "${file}" must be a translation key, ` +
        'a group, or a prefix such as "statuses.*"; a wildcard is allowed only as the final ".*".',
    );

  if (entry.length === 0 || /\s/.test(entry)) throw invalid();
  if (entry === "*") return usageOf({ prefixes: [""] });

  if (entry.endsWith(".*")) {
    const prefix = entry.slice(0, -1);
    if (prefix.includes("*") || prefix.includes("..")) throw invalid();
    return usageOf({ prefixes: [prefix] });
  }

  if (entry.includes("*")) throw invalid();

  return usageOf({ keys: [entry] });
}

/** The union of several usages: a dynamic lookup anywhere makes the union dynamic. */
export function mergeTranslationUsage(usages: readonly TranslationUsage[]): TranslationUsage {
  return usageOf({
    keys: usages.flatMap((usage) => usage.keys),
    prefixes: usages.flatMap((usage) => usage.prefixes),
    dynamic: usages.some((usage) => usage.dynamic),
    dynamicSites: usages.flatMap((usage) => usage.dynamicSites),
  });
}

/** Whether a usage can reach `key`. A dynamic usage reaches every key. */
export function isTranslationKeyUsed(usage: TranslationUsage, key: string): boolean {
  if (usage.dynamic) return true;
  if (usage.keys.some((declared) => key === declared || key.startsWith(`${declared}.`))) {
    return true;
  }

  return usage.prefixes.some((prefix) => key.startsWith(prefix));
}

type KeyCandidate = { readonly kind: "key" | "prefix"; readonly value: string };

/** Candidates, `"dynamic"` when the key is unknown, or `"none"` when there is no key (an inline translation object, no argument). */
type KeyResolution = readonly KeyCandidate[] | "dynamic" | "none";

function unwrap(node: ast.Node): ast.Node {
  let current = node;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function combine(left: KeyResolution, right: KeyResolution): KeyResolution {
  if (left === "dynamic" || right === "dynamic") return "dynamic";
  if (left === "none") return right;
  if (right === "none") return left;
  return [...left, ...right];
}

function resolveKeyExpression(
  node: ast.Node | undefined,
  constants: ReadonlyMap<string, string>,
): KeyResolution {
  if (node === undefined) return "none";

  const value = unwrap(node);

  if (value.type === "Literal" && typeof value.value === "string") {
    return [{ kind: "key", value: value.value }];
  }

  if (value.type === "TemplateLiteral") {
    const head = value.quasis[0]?.value.cooked ?? "";
    if (head.length === 0) return "dynamic";
    return value.expressions.length === 0
      ? [{ kind: "key", value: head }]
      : [{ kind: "prefix", value: head }];
  }

  if (value.type === "Identifier") {
    const constant = constants.get(value.name);
    return constant === undefined ? "dynamic" : [{ kind: "key", value: constant }];
  }

  if (value.type === "ConditionalExpression") {
    return combine(
      resolveKeyExpression(value.consequent, constants),
      resolveKeyExpression(value.alternate, constants),
    );
  }

  if (value.type === "LogicalExpression") {
    return combine(
      resolveKeyExpression(value.left, constants),
      resolveKeyExpression(value.right, constants),
    );
  }

  // An inline `{ en: "...", ar: "..." }` translation carries its own text.
  if (value.type === "ObjectExpression") return "none";

  return "dynamic";
}

/** Top-level `const NAME = "literal"` declarations, which a key may name through an identifier. */
function moduleConstants(source: ast.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();

  for (const statement of source.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;

    if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") continue;

    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier" || declarator.init === null) continue;

      const init = unwrap(declarator.init);

      if (init.type === "Literal" && typeof init.value === "string") {
        constants.set(declarator.id.name, init.value);
      } else if (init.type === "TemplateLiteral" && init.expressions.length === 0) {
        constants.set(declarator.id.name, init.quasis[0]?.value.cooked ?? "");
      }
    }
  }

  return constants;
}

/**
 * Local names bound to a translator: the result of `useTrans()`, including an
 * aliased import of it. Calling one of them is a lookup like calling `trans`.
 */
function translatorBindings(source: ast.SourceFile): Set<string> {
  const factories = new Set(TRANSLATOR_FACTORIES);
  const bindings = new Set<string>();

  for (const statement of source.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : "";
      if (TRANSLATOR_FACTORIES.has(imported)) factories.add(specifier.local.name);
    }
  }

  const visit = (node: ast.Node): void => {
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init !== null &&
      node.init.type === "CallExpression" &&
      node.init.callee.type === "Identifier" &&
      factories.has(node.init.callee.name)
    ) {
      bindings.add(node.id.name);
    }
    ast.forEachChild(node, visit);
  };

  ast.forEachChild(source, visit);

  return bindings;
}

function isTranslatorName(name: string, bindings: ReadonlySet<string>): boolean {
  return Object.hasOwn(TRANSLATOR_KEY_ARGUMENT, name) || bindings.has(name);
}

/**
 * Scan one source file for translation lookups and the modules it loads.
 *
 * Literal keys, static-prefix templates, identifiers bound to a module-level
 * string constant, and choices between those (`a ? "x" : "y"`) all resolve. Any
 * other key expression is `dynamic`, and so is a translator that escapes as a
 * value (passed on, returned, stored): whoever receives it can call it with any
 * key.
 */
export function scanTranslationSource(fileName: string, text: string): TranslationSourceScan {
  const source = ast.parseSourceFile(fileName, text);
  const constants = moduleConstants(source);
  const bindings = translatorBindings(source);
  const keys: string[] = [];
  const prefixes: string[] = [];
  const dynamicSites: TranslationDynamicSite[] = [];
  const imports: string[] = [];

  const markDynamic = (node: ast.Node, lookup: string): void => {
    dynamicSites.push({ file: fileName, ...ast.positionOf(source, node), text: lookup });
  };

  const visit = (node: ast.Node): void => {
    if (node.type === "ImportDeclaration") {
      const specifiers = node.specifiers;
      const typeOnly =
        node.importKind === "type" ||
        (specifiers.length > 0 &&
          specifiers.every(
            (specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type",
          ));
      if (!typeOnly) imports.push(node.source.value);
    } else if (
      (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
      node.source !== null &&
      node.exportKind !== "type"
    ) {
      imports.push(node.source.value);
    } else if (node.type === "ImportExpression") {
      const specifier = unwrap(node.source);
      if (specifier.type === "Literal" && typeof specifier.value === "string") {
        imports.push(specifier.value);
      }
    } else if (node.type === "CallExpression") {
      const callee = unwrap(node.callee);

      if (callee.type === "Identifier" && isTranslatorName(callee.name, bindings)) {
        const index = TRANSLATOR_KEY_ARGUMENT[callee.name] ?? 0;
        const argument = node.arguments[index];
        const resolution =
          argument === undefined
            ? "none"
            : argument.type === "SpreadElement"
              ? "dynamic"
              : resolveKeyExpression(argument, constants);

        if (resolution === "dynamic") {
          markDynamic(argument ?? node, argument === undefined ? "" : sourceText(text, argument));
        } else if (resolution !== "none") {
          for (const candidate of resolution) {
            if (candidate.kind === "key") keys.push(candidate.value);
            else prefixes.push(candidate.value);
          }
        }
      }
    } else if (node.type === "Identifier" && isTranslatorName(node.name, bindings)) {
      const parent = ast.parentOf(node);
      if (parent !== undefined && escapesAsValue(parent, node)) markDynamic(node, node.name);
    }

    ast.forEachChild(node, visit);
  };

  ast.forEachChild(source, visit);

  return {
    usage: usageOf({ keys, prefixes, dynamic: dynamicSites.length > 0, dynamicSites }),
    imports: [...new Set(imports)],
  };
}

/** A translator identifier handed on as a value, rather than called or declared. */
function escapesAsValue(parent: ast.Node, node: ast.Node): boolean {
  if (!VALUE_POSITIONS.has(parent.type)) return false;

  switch (parent.type) {
    case "CallExpression":
    case "NewExpression":
      return parent.callee !== node;
    case "Property":
      return parent.value === node;
    case "VariableDeclarator":
      return parent.init === node;
    case "ArrowFunctionExpression":
      return parent.body === node;
    case "AssignmentExpression":
      return parent.right === node;
    default:
      return true;
  }
}

function sourceText(text: string, node: ast.Node): string {
  return text.slice(node.start, node.end);
}

/**
 * The `config.translations` declaration of a page's setup file, as its raw
 * entries. Read statically, like `config.route`, so the build never runs the
 * file. `undefined` when the file declares none.
 */
export function readTranslationDeclarations(
  fileName: string,
  text: string,
): readonly string[] | undefined {
  const source = ast.parseSourceFile(fileName, text);
  const malformed = (): Error =>
    new Error(`config.translations in "${fileName}" must be an array of string literals.`);

  for (const statement of source.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : undefined;
    if (declaration?.type !== "VariableDeclaration") continue;

    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier" || declarator.id.name !== "config") continue;
      if (declarator.init === null) continue;

      const init = unwrap(declarator.init);
      if (init.type !== "ObjectExpression") continue;

      for (const property of init.properties) {
        if (property.type !== "Property" || property.computed) continue;

        const name =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.type === "Literal" && typeof property.key.value === "string"
              ? property.key.value
              : undefined;
        if (name !== "translations") continue;

        const value = unwrap(property.value);
        if (value.type !== "ArrayExpression") throw malformed();

        return value.elements.map((element) => {
          const literal = element === null ? undefined : unwrap(element);
          if (literal?.type !== "Literal" || typeof literal.value !== "string") throw malformed();
          return literal.value;
        });
      }
    }
  }

  return undefined;
}
