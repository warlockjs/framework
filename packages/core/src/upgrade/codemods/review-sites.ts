import type * as TsMorph from "ts-morph";
import type { Codemod, CodemodContext, CodemodOutput } from "../types";
import {
  importedLocalNames,
  importsFrom,
  manualAt,
  objectProperty,
  objectPropertyNames,
} from "./helpers";

/**
 * Breaking changes that are behavioural decisions, not mechanical edits. These
 * codemods change nothing; they list every call site to review with the
 * reason, so nothing is missed.
 */

/** Call expressions in files that import from `moduleName`. */
function callsIn(context: CodemodContext, moduleName: string): TsMorph.CallExpression[] {
  const { SyntaxKind } = context.tsMorph;
  return context.sourceFiles
    .filter((sourceFile) => importsFrom(sourceFile, moduleName))
    .flatMap((sourceFile) => sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression));
}

function calleeName(context: CodemodContext, call: TsMorph.CallExpression): string | undefined {
  const { Node } = context.tsMorph;
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
}

/** `v.object(...)....catch(` → whether the chain starts at a container factory. */
function chainRoot(context: CodemodContext, call: TsMorph.CallExpression): string | undefined {
  const { Node } = context.tsMorph;
  let current: TsMorph.Node = call.getExpression();
  let root: string | undefined;
  for (;;) {
    if (Node.isPropertyAccessExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression();
      if (Node.isPropertyAccessExpression(callee)) root = callee.getText();
      current = callee;
      continue;
    }
    return root;
  }
}

export const sealValidateResult: Codemod = {
  id: "seal-validate-result",
  version: "5.30.0",
  package: "@warlock.js/seal",
  title: "Check `isValid` before reading `validate()` data",
  skill: "seal-basics",
  run(context) {
    const { Node } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };

    for (const sourceFile of context.sourceFiles) {
      const validators = importedLocalNames(sourceFile, "@warlock.js/seal", "validate");
      if (validators.size === 0) continue;
      const text = sourceFile.getFullText();

      for (const call of sourceFile.getDescendantsOfKind(
        context.tsMorph.SyntaxKind.CallExpression,
      )) {
        const callee = call.getExpression();
        if (!Node.isIdentifier(callee) || !validators.has(callee.getText())) continue;
        const declaration = call.getFirstAncestorByKind(
          context.tsMorph.SyntaxKind.VariableDeclaration,
        );
        const name = declaration?.getNameNode();
        if (!name || !Node.isIdentifier(name)) continue;
        const variable = name.getText();
        if (!text.includes(`${variable}.data`) || text.includes(`${variable}.isValid`)) continue;
        output.manual.push(
          manualAt(
            context,
            call,
            `\`${variable}.data\` is \`undefined\` when validation fails and typed only after \`if (${variable}.isValid)\`. Check it before reading the data.`,
          ),
        );
      }
    }

    return output;
  },
};

export const aiToolDispatch: Codemod = {
  id: "ai-tool-dispatch",
  version: "5.30.0",
  package: "@warlock.js/ai",
  title: "Review agents whose tools now run concurrently",
  skill: "upgrade-from-5-29",
  run(context) {
    const { Node } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };

    for (const call of callsIn(context, "@warlock.js/ai")) {
      const name = calleeName(context, call);
      if (name !== "agent" && name !== "spawnSubAgent") continue;
      const options = call.getArguments()[0];
      if (!options || !Node.isObjectLiteralExpression(options)) continue;
      const keys = objectPropertyNames(context.tsMorph, options);
      if (!keys.has("tools") || keys.has("toolDispatch") || keys.has("maxConcurrentTools"))
        continue;
      output.manual.push(
        manualAt(
          context,
          call,
          `\`${name}()\` with tools now runs one trip's tools concurrently (up to 4). If a tool depends on another's side effects, set \`toolDispatch: "sequential"\`.`,
        ),
      );
    }

    return output;
  },
};

const RESERVED_ANTHROPIC_BODY_KEYS = [
  "model",
  "messages",
  "system",
  "tools",
  "mcp_servers",
  "stream",
];

export const aiAnthropicBody: Codemod = {
  id: "ai-anthropic-body",
  version: "5.30.0",
  package: "@warlock.js/ai-anthropic",
  title: "Move reserved keys out of `providerOptions.anthropic.body`",
  skill: "upgrade-from-5-29",
  run(context) {
    const { Node, SyntaxKind } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };

    for (const sourceFile of context.sourceFiles) {
      for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
        const anthropic = objectProperty(context.tsMorph, literal, "anthropic");
        if (!anthropic || !Node.isObjectLiteralExpression(anthropic)) continue;
        const parent = literal.getParent();
        if (
          !parent ||
          !Node.isPropertyAssignment(parent) ||
          parent.getName() !== "providerOptions"
        ) {
          continue;
        }
        const body = objectProperty(context.tsMorph, anthropic, "body");
        if (!body || !Node.isObjectLiteralExpression(body)) continue;
        const reserved = RESERVED_ANTHROPIC_BODY_KEYS.filter((key) =>
          objectPropertyNames(context.tsMorph, body).has(key),
        );
        if (reserved.length === 0) continue;
        output.manual.push(
          manualAt(
            context,
            body,
            `\`providerOptions.anthropic.body\` can no longer set ${reserved.map((key) => `\`${key}\``).join(", ")} (it throws InvalidRequestError). Use the normal model/messages/tools options.`,
          ),
        );
      }
    }

    return output;
  },
};

export const aiFinishReason: Codemod = {
  id: "ai-finish-reason",
  version: "5.30.0",
  package: "@warlock.js/ai",
  title: "Handle the new finish reasons",
  skill: "upgrade-from-5-29",
  run(context) {
    const { SyntaxKind } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };

    for (const sourceFile of context.sourceFiles) {
      if (!importsFrom(sourceFile, "@warlock.js/ai")) continue;
      for (const statement of sourceFile.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
        if (!/finishReason$/.test(statement.getExpression().getText())) continue;
        output.manual.push(
          manualAt(
            context,
            statement,
            'A `finishReason` switch: 5.30 adds "context_exceeded", "pause_turn" and "refusal" (Anthropic used to report them as "length"/"error"). Handle each.',
          ),
        );
      }
    }

    return output;
  },
};

export const sealRefineOutput: Codemod = {
  id: "seal-refine-output",
  version: "5.31.0",
  package: "@warlock.js/seal",
  title: "Review `.refine()` callbacks",
  skill: "seal-basics",
  run(context) {
    const output: CodemodOutput = { edits: [], manual: [] };
    for (const call of callsIn(context, "@warlock.js/seal")) {
      if (calleeName(context, call) !== "refine") continue;
      output.manual.push(
        manualAt(
          context,
          call,
          "`.refine()` now runs on the validated output, after child rules and transforms, and skips absent/null/invalid values. Move checks that need the raw input to `.addRule()`.",
        ),
      );
    }
    return output;
  },
};

const CONTAINERS = /^v\.(object|array|record|tuple)$/;

export const sealContainerCatch: Codemod = {
  id: "seal-container-catch",
  version: "5.31.0",
  package: "@warlock.js/seal",
  title: "Move `.catch()` off container validators",
  skill: "seal-basics",
  run(context) {
    const output: CodemodOutput = { edits: [], manual: [] };
    for (const call of callsIn(context, "@warlock.js/seal")) {
      if (calleeName(context, call) !== "catch") continue;
      const root = chainRoot(context, call);
      if (!root || !CONTAINERS.test(root)) continue;
      output.manual.push(
        manualAt(
          context,
          call,
          `\`.catch()\` on \`${root}()\` is now a no-op, including for the container's own rules. Put the catch on the child validators, or handle the failed result.`,
        ),
      );
    }
    return output;
  },
};

export const sealUnionOutput: Codemod = {
  id: "seal-union-output",
  version: "5.31.0",
  package: "@warlock.js/seal",
  title: "Review `v.union()` output",
  skill: "seal-basics",
  run(context) {
    const output: CodemodOutput = { edits: [], manual: [] };
    for (const call of callsIn(context, "@warlock.js/seal")) {
      if (call.getExpression().getText() !== "v.union") continue;
      output.manual.push(
        manualAt(
          context,
          call,
          "`v.union()` now returns the matched branch's validated output (trimmed strings, parsed dates, defaults, stripped keys). Check code that persists or compares it.",
        ),
      );
    }
    return output;
  },
};

export const aiCompactionOptIn: Codemod = {
  id: "ai-compaction-opt-in",
  version: "5.31.0",
  package: "@warlock.js/ai",
  title: "Give agent compaction its required settings",
  skill: "upgrade-from-5-29",
  run(context) {
    const { Node } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };
    for (const call of callsIn(context, "@warlock.js/ai")) {
      if (calleeName(context, call) !== "agent") continue;
      const options = call.getArguments()[0];
      if (!options || !Node.isObjectLiteralExpression(options)) continue;
      const compaction = objectProperty(context.tsMorph, options, "compaction");
      if (!compaction) continue;
      const keys = Node.isObjectLiteralExpression(compaction)
        ? objectPropertyNames(context.tsMorph, compaction)
        : new Set<string>();
      if (keys.has("afterTokens") && keys.has("summarize")) continue;
      output.manual.push(
        manualAt(
          context,
          compaction,
          "`compaction` is opt-in in 5.31 and needs `afterTokens` and a `summarize` callback (optional `keep`, `countTokens`).",
        ),
      );
    }
    return output;
  },
};

export const rateLimitDefaults: Codemod = {
  id: "rate-limit-defaults",
  version: "5.31.0",
  package: "@warlock.js/core",
  title: "Review the rate limit that now applies everywhere",
  skill: "configure-app",
  run(context) {
    const output: CodemodOutput = { edits: [], manual: [] };
    const hint =
      "Rate limits now apply in production and development to every route, page and static asset: 60 requests/minute per IP by default, shared. Review `http.rateLimit.max`, set `trustProxy` or a `keyGenerator` behind a proxy, or `global: false` to keep only per-route limits.";

    const httpConfig = context.sourceFiles.find((sourceFile) =>
      context.relativePath(sourceFile).match(/^src\/config\/http\.tsx?$/),
    );
    if (!httpConfig) {
      output.manual.push({ file: "src/config/http.ts", line: 1, hint });
      return output;
    }
    if (!/\brateLimit\s*:/.test(httpConfig.getFullText())) {
      output.manual.push({ file: context.relativePath(httpConfig), line: 1, hint });
    }
    return output;
  },
};
