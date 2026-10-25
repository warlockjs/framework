import { parse } from "@babel/parser";
import type { Plugin } from "vite";
import {
  isAppSourcePath,
  isClientFile,
  isRecognizedUniversalSurface,
  isServerFile,
} from "./gate-a-resolve";
import {
  isProjectableFile,
  isSetupRegisterProjectionFile,
  projectModule,
  projectSetupRegisterModule,
} from "./projection";
import { moduleKey } from "../shared/module-key";

export type SsrBoundaryState = {
  readonly appRoot: string;
  readonly clientBoundModules: Set<string>;
  readonly clientImportsByModule: Map<string, Set<string>>;
};

const CODE_MODULE_EXTENSION = /\.([cm]?[jt]sx?)$/;

/** The mutable record the SSR client-boundary mirror keeps for one dev server. */
export function createSsrBoundaryState(appRoot: string): SsrBoundaryState {
  return {
    appRoot,
    clientBoundModules: new Set(),
    clientImportsByModule: new Map(),
  };
}

/** Whether the mirror has classified this module id as client-reachable. */
export function isClientBoundModule(state: SsrBoundaryState, id: string): boolean {
  return state.clientBoundModules.has(clientBoundaryKey(id));
}

/**
 * A setup sidecar has two deliberately different module views. Its ordinary
 * id is server-only, while the framework-owned query exposes only `register`
 * to the client. Retaining that query here prevents the latter from making a
 * later raw `ssrLoadModule(setupFile)` look client-bound.
 */
function clientBoundaryKey(id: string): string {
  const bare = moduleKey(id);
  return isSetupRegisterProjectionFile(id) ? `${bare}?warlock-setup-register` : bare;
}

/**
 * Whether `id` is a client surface WITHOUT having to be reached through the
 * projected-import walk first — the seed set `clientViewOf` marks before any
 * graph traversal has happened.
 *
 * Deliberately asks nothing about WHERE the file lives. A file under
 * `src/web/**` is not, by that location alone, on the client boundary: dev's
 * `middleware`/`loader`/etc. exports are stripped by projection before this
 * function is ever consulted for THEM specifically, and a plain server-only
 * helper reached only through `root.tsx`'s (stripped) `middleware` export —
 * `optional-auth.ts` importing `cookie-session.middleware.ts` — has no route
 * into the surviving graph at all. Location used to override that and refuse
 * it anyway; the boundary is the post-projection import graph, per canon
 * `10f6041c`, the same rule `gate-a-resolve.ts` already enforces by having
 * deliberately removed its own location-based rule 4 (see `ruleViolation`'s
 * comment there). A file that genuinely belongs in the client graph — a
 * `.page.tsx`, a `layout.tsx`, the app root, or anything one of those imports
 * — is still admitted, either directly by `isRecognizedUniversalSurface` or by
 * `resolveId`'s graph walk (`clientBoundModules` / `clientImportsByModule`)
 * once something already in the graph imports it. Nothing under `src/web/**`
 * needs a location exemption to be reached that way.
 */
function isStatelessClientSurface(id: string, appRoot: string): boolean {
  const bare = moduleKey(id);
  if (!isAppSourcePath(bare, appRoot)) return false;
  if (isServerFile(bare, appRoot)) return false;

  return isProjectableFile(bare) || isRecognizedUniversalSurface(bare);
}

/**
 * Returns only runtime graph edges. Type declarations are not browser
 * dependencies, whereas an empty import still evaluates its module.
 */
export function collectImportSpecifiers(code: string): Set<string> {
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const imports = new Set<string>();

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    const record = node as Record<string, any>;
    if (record.source?.type === "StringLiteral") {
      if (record.type === "ImportDeclaration") {
        const fullyTypeOnly =
          record.importKind === "type" ||
          (record.specifiers.length > 0 &&
            record.specifiers.every((specifier: any) => specifier.importKind === "type"));
        if (!fullyTypeOnly) imports.add(record.source.value);
      } else if (
        record.type === "ExportNamedDeclaration" ||
        record.type === "ExportAllDeclaration"
      ) {
        const fullyTypeOnly =
          record.exportKind === "type" ||
          (record.specifiers?.length > 0 &&
            record.specifiers.every((specifier: any) => specifier.exportKind === "type"));
        if (!fullyTypeOnly) imports.add(record.source.value);
      }
    }
    if (
      record.type === "CallExpression" &&
      record.callee?.type === "Import" &&
      record.arguments?.[0]?.type === "StringLiteral"
    ) {
      imports.add(record.arguments[0].value);
    }
    if (record.type === "ImportExpression" && record.source?.type === "StringLiteral") {
      imports.add(record.source.value);
    }

    for (const [key, child] of Object.entries(record)) {
      if (
        key === "type" ||
        key === "start" ||
        key === "end" ||
        key === "loc" ||
        key === "range" ||
        key.endsWith("Comments") ||
        key === "extra"
      ) {
        continue;
      }
      walk(child);
    }
  }

  walk(ast.program);
  return imports;
}

/**
 * Dev SSR loads a setup file raw, so build's projection refusal (an unread
 * top-level call such as `const guard = requireUser(opts)`) would never surface
 * there. Run the same register projection for its refusal only: the output is
 * discarded and SSR keeps receiving the raw source.
 */
function validateRawSetupProjection(state: SsrBoundaryState, code: string, bare: string): void {
  if (!bare.endsWith(".setup.ts") || !isAppSourcePath(bare, state.appRoot)) return;
  projectSetupRegisterModule(code, `${bare}?warlock-setup-register`);
}

function clientViewOf(state: SsrBoundaryState, code: string, id: string): string | undefined {
  const key = clientBoundaryKey(id);
  const bare = moduleKey(id);
  const setupRegisterProjection = isSetupRegisterProjectionFile(id);
  if (!setupRegisterProjection) validateRawSetupProjection(state, code, bare);
  if (
    !state.clientBoundModules.has(key) &&
    !setupRegisterProjection &&
    !isStatelessClientSurface(bare, state.appRoot)
  ) {
    return undefined;
  }

  state.clientBoundModules.add(key);
  if (!CODE_MODULE_EXTENSION.test(bare)) {
    state.clientImportsByModule.set(key, new Set());
    return code;
  }

  const clientCode = setupRegisterProjection
    ? projectSetupRegisterModule(code, id).code
    : isProjectableFile(bare)
      ? projectModule(code, bare).code
      : code;
  state.clientImportsByModule.set(key, collectImportSpecifiers(clientCode));
  return clientCode;
}

function markResolvedClientModule(
  state: SsrBoundaryState,
  resolved: { id: string } | string | null | false | void,
): void {
  if (!resolved) return;
  const id = typeof resolved === "string" ? resolved : resolved.id;
  if (!id.includes("\0")) state.clientBoundModules.add(clientBoundaryKey(id));
}

function isServerEnvironment(context: {
  environment?: { config: { consumer?: string } };
}): boolean {
  return context.environment?.config.consumer === "server";
}

type ServerReachedClientEdge = {
  /** Whether the IMPORTER is on the client boundary (client-bound). */
  readonly importerIsClientBound: boolean;
  /** The resolved id the importer's specifier landed on, or a falsy miss. */
  readonly resolvedTarget: string | undefined;
  /** The importer id, used only to name the offending edge in the message. */
  readonly importer: string;
};

/**
 * The PURE decision behind the server-code-imports-`.client` refusal, factored
 * out so it is unit-testable without booting Vite.
 *
 * `.client.*` is a client-only boundary: such a module may be imported by
 * pages, layouts and components (and then renders on the server unless wrapped
 * in `<ClientOnly>`), but never by server-only code. A SERVER-side importer
 * (`importerIsClientBound === false`) reaching a `.client` target is therefore
 * an error. An all-client graph (a client-bound importer → `.client`) and any
 * edge whose target is not a `.client` module stay silent. Returns the message
 * to refuse with, or `undefined` when nothing should be refused.
 */
export function serverReachedClientDiagnostic({
  importerIsClientBound,
  resolvedTarget,
  importer,
}: ServerReachedClientEdge): string | undefined {
  if (importerIsClientBound) return undefined;
  if (!resolvedTarget) return undefined;
  if (!isClientFile(resolvedTarget)) return undefined;

  return [
    `[warlock:web] server-only code imports a .client module.`,
    ``,
    `Import chain: ${moduleKey(importer)} → ${moduleKey(resolvedTarget)}`,
    `Cause: "${moduleKey(importer)}" is reachable from the SERVER graph, yet it imports the client-only module "${moduleKey(resolvedTarget)}". A .client.* module may be imported by pages, layouts and components, never by controllers, services, repositories, models, routes, connectors, loaders or *.server.ts files.`,
    `Fix: Remove the import from the server code. Pass the data the client module needs through a loader, or move the shared logic into a universal file that is neither .client nor server-only.`,
  ].join("\n");
}

/**
 * Keeps the production/client pipeline byte-identical, while giving Gate A
 * and Gate B a validation-only view in Vite's development SSR environment.
 * SSR still evaluates the original source: only the gates receive the
 * projected client view, so loader/server exports retain their legitimate
 * server access while component-visible code is refused before evaluation.
 */
export function clientEnvironmentOnly(plugin: Plugin, ssrState: SsrBoundaryState): Plugin {
  const validatesDevSsr =
    plugin.name === "warlock:gate-a-resolve" || plugin.name === "warlock:gate-b-secrets";
  const originalTransform =
    typeof plugin.transform === "function" ? plugin.transform : plugin.transform?.handler;
  const originalResolveId =
    typeof plugin.resolveId === "function" ? plugin.resolveId : plugin.resolveId?.handler;
  const originalBuildStart =
    typeof plugin.buildStart === "function" ? plugin.buildStart : plugin.buildStart?.handler;

  return {
    ...plugin,
    applyToEnvironment(environment) {
      return (
        environment.config.consumer === "client" ||
        (validatesDevSsr && environment.config.consumer === "server")
      );
    },
    buildStart: originalBuildStart
      ? function (...args) {
          if (isServerEnvironment(this)) return;
          return originalBuildStart.apply(this, args);
        }
      : undefined,
    transform: originalTransform
      ? async function (code, id, options) {
          if (!isServerEnvironment(this)) {
            return originalTransform.call(this, code, id, options);
          }

          const clientCode = clientViewOf(ssrState, code, id);
          if (clientCode === undefined) return null;

          const transformed = await originalTransform.call(this, clientCode, id, {
            ...options,
            // Rolldown always supplies the module type; the wrapped hook type
            // marks it optional, and its own type requires it.
            moduleType: options?.moduleType ?? "js",
            ssr: false,
          });

          // Vite can externalize a package in the SSR environment before its
          // normal resolver walk offers that edge to a plugin. Gate A cannot
          // wait for that walk: validate every import that survived projection
          // now, while the original TypeScript source and importer are known.
          if (plugin.name === "warlock:gate-a-resolve" && originalResolveId) {
            for (const source of ssrState.clientImportsByModule.get(clientBoundaryKey(id)) ?? []) {
              const resolved = await originalResolveId.call(this, source, id, {
                attributes: {},
                isEntry: false,
                ssr: false,
              });
              markResolvedClientModule(ssrState, resolved);
            }
          }

          return transformed;
        }
      : undefined,
    resolveId: originalResolveId
      ? async function (source, importer, options) {
          if (!isServerEnvironment(this)) {
            return originalResolveId.call(this, source, importer, options);
          }

          if (!importer) return null;
          const importerKey = clientBoundaryKey(importer);
          const isClientBound =
            ssrState.clientBoundModules.has(importerKey) ||
            isStatelessClientSurface(importerKey, ssrState.appRoot);
          if (!isClientBound) {
            // A server edge. Resolution is unchanged, except that an app-source
            // importer naming a `.client` module is refused: `.client.*` is a
            // client-only boundary and server-only code must never import it.
            //
            // The resolve below is judged under `ssr: false`, so Gate A's own
            // resolveId can refuse a legitimately server-only import (it throws
            // `this.error`). That refusal must not escape this check, so it is
            // swallowed: a genuine `.client` target resolves cleanly and is still
            // caught; only non-`.client` server imports throw, and those are not
            // this check's case.
            let targetId: string | undefined;
            try {
              const serverEdgeTarget = await originalResolveId.call(this, source, importer, {
                ...options,
                ssr: false,
              });
              targetId =
                typeof serverEdgeTarget === "string"
                  ? serverEdgeTarget
                  : serverEdgeTarget && typeof serverEdgeTarget === "object"
                    ? serverEdgeTarget.id
                    : undefined;
            } catch {
              targetId = undefined;
            }

            const message = serverReachedClientDiagnostic({
              importerIsClientBound: false,
              resolvedTarget: targetId,
              importer,
            });
            if (message && targetId && isAppSourcePath(moduleKey(importer), ssrState.appRoot)) {
              this.error(message);
            }
            return null;
          }

          const survivingImports = ssrState.clientImportsByModule.get(importerKey);
          if (survivingImports && !survivingImports.has(source)) return null;

          const resolved = await originalResolveId.call(this, source, importer, {
            ...options,
            ssr: false,
          });
          markResolvedClientModule(ssrState, resolved);
          return resolved;
        }
      : undefined,
  };
}
