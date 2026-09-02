// remark plugin, wired into Astro's `markdown.remarkPlugins`. Runs only on
// `.mdx` files (Astro shares markdown config with its MDX integration, so
// `.md` files reach this plugin too and are skipped). Walks the parsed
// mdast/estree — no filesystem grep — to catch three classes of MDX
// authoring mistakes that would otherwise only surface as a cryptic runtime
// "X is not defined" error deep in the rendered page:
//
//   1. An `import`/`export` statement written somewhere the MDX compiler
//      doesn't recognize as ESM (e.g. indented, inside a blockquote/list)
//      gets parsed as a plain text paragraph instead — that's a silent typo
//      that renders literally as text.
//   2. An `mdxjsEsm` node placed after rendered content has already started.
//      MDX allows this syntactically, but it reads as broken authoring intent
//      (imports declared mid-document) and this repo requires them up top.
//   3. A capitalized JSX tag (a "component", by MDX/JSX convention) used
//      without any import or local declaration backing it — the classic
//      "forgot to import the component" mistake.

function isEsmNode(node) {
  return node.type === "mdxjsEsm";
}

function isFrontmatterNode(node) {
  return node.type === "yaml" || node.type === "toml";
}

function collectPatternNames(pattern, names) {
  if (!pattern) return;

  switch (pattern.type) {
    case "Identifier":
      names.add(pattern.name);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        collectPatternNames(prop.type === "RestElement" ? prop.argument : prop.value, names);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        collectPatternNames(element, names);
      }
      break;
    case "AssignmentPattern":
      collectPatternNames(pattern.left, names);
      break;
    case "RestElement":
      collectPatternNames(pattern.argument, names);
      break;
    default:
      break;
  }
}

function collectDeclarationNames(declaration, names) {
  if (!declaration) return;

  switch (declaration.type) {
    case "VariableDeclaration":
      for (const declarator of declaration.declarations) {
        collectPatternNames(declarator.id, names);
      }
      break;
    case "FunctionDeclaration":
    case "ClassDeclaration":
      if (declaration.id) names.add(declaration.id.name);
      break;
    default:
      break;
  }
}

function collectStatementBindings(statement, names) {
  switch (statement.type) {
    case "ImportDeclaration":
      // A bare `import "./foo.css"` has no specifiers — side-effect only,
      // contributes no binding, and is not itself an error.
      for (const specifier of statement.specifiers) {
        names.add(specifier.local.name);
      }
      break;
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration":
      collectDeclarationNames(statement.declaration, names);
      break;
    case "VariableDeclaration":
    case "FunctionDeclaration":
    case "ClassDeclaration":
      collectDeclarationNames(statement, names);
      break;
    default:
      break;
  }
}

function collectBindings(tree) {
  const names = new Set();

  function walk(node) {
    if (isEsmNode(node)) {
      const program = node.data && node.data.estree;
      if (program) {
        for (const statement of program.body) {
          collectStatementBindings(statement, names);
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }

  walk(tree);
  return names;
}

function checkEsmOrdering(tree, file) {
  let contentStarted = false;

  for (const node of tree.children) {
    if (isFrontmatterNode(node)) continue;

    if (isEsmNode(node)) {
      if (contentStarted) {
        file.fail(
          "Import/export statement must appear before rendered content — move it to the top of the file.",
          node,
          "remark-validate-mdx-components:esm-order",
        );
      }
      continue;
    }

    contentStarted = true;
  }
}

function checkTextParsedEsm(tree, file) {
  function walk(node) {
    if (node.type === "paragraph") {
      const first = node.children && node.children[0];
      if (first && first.type === "text" && /^(import|export)\s/.test(first.value)) {
        file.fail(
          "This looks like an import/export statement, but the MDX compiler parsed it as plain text — it must be an unindented top-level statement.",
          node,
          "remark-validate-mdx-components:esm-parsed-as-text",
        );
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }

  walk(tree);
}

function checkJsxBindings(tree, file, bindings) {
  function walk(node) {
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const name = node.name;
      // Fragments (`<>...</>`) serialize with `name: null`; lowercase tags
      // are HTML/custom elements, not components — neither needs a binding.
      if (name && /^[A-Z]/.test(name)) {
        const base = name.split(/[.:]/)[0];
        if (!bindings.has(base)) {
          file.fail(
            `Component <${name}> is used but not imported or declared in this file.`,
            node,
            "remark-validate-mdx-components:missing-binding",
          );
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }

  walk(tree);
}

export default function remarkValidateMdxComponents() {
  return (tree, file) => {
    if (file.extname !== ".mdx") return;

    checkEsmOrdering(tree, file);
    checkTextParsedEsm(tree, file);
    checkJsxBindings(tree, file, collectBindings(tree));
  };
}
