import type { Codemod, CodemodOutput } from "../types";
import { manualAt, removeNode } from "./helpers";

const DEFAULT_VIEWPORT = "width=device-width,initial-scale=1";

/**
 * 5.30: `<Head />` emits `width=device-width, initial-scale=1` itself. Removes
 * a hand-written duplicate of exactly that tag next to `<Head`; a different
 * viewport is listed so it can move to `metadata.viewport`.
 */
export const headViewport: Codemod = {
  id: "head-viewport",
  version: "5.30.0",
  package: "@warlock.js/web",
  title: "Remove the duplicate viewport meta tag",
  skill: "upgrade-from-5-29",
  run(context) {
    const { Node, SyntaxKind } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };

    for (const sourceFile of context.sourceFiles) {
      if (!sourceFile.getFilePath().endsWith(".tsx")) continue;
      if (!/<Head[\s/>]/.test(sourceFile.getFullText())) continue;

      for (const element of sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
        if (element.getTagNameNode().getText() !== "meta") continue;

        const attributes = new Map<string, string | undefined>();
        for (const attribute of element.getAttributes()) {
          if (!Node.isJsxAttribute(attribute)) continue;
          const initializer = attribute.getInitializer();
          const value =
            initializer && Node.isStringLiteral(initializer)
              ? initializer.getLiteralValue()
              : undefined;
          attributes.set(attribute.getNameNode().getText(), value);
        }
        if (attributes.get("name") !== "viewport") continue;

        const content = attributes.get("content");
        if (attributes.size === 2 && content?.replace(/\s/g, "") === DEFAULT_VIEWPORT) {
          output.edits.push(
            removeNode(context, element, "removed a viewport tag <Head /> already emits"),
          );
        } else {
          output.manual.push(
            manualAt(
              context,
              element,
              "`<Head />` now emits its own viewport tag. Move this one to `metadata.viewport` (or set it to `false`) so the page does not get two.",
            ),
          );
        }
      }
    }

    return output;
  },
};
