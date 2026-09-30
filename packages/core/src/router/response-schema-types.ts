import { posix, relative, sep } from "node:path";

/**
 * Where a resource class lives: the module it is exported from and the export name.
 */
export type ResourceModuleExport = Readonly<{
  file: string;
  exportName: string;
}>;

/**
 * Import location of a resource as it is written in a generated declaration file.
 * `importPath` has no extension and starts with `./` or `../`.
 */
export type ResourceTypeReference = Readonly<{
  importPath: string;
  exportName: string;
}>;

/**
 * Maps a response-schema resource value back to where it is exported from.
 * Returns `undefined` when the value is not a known resource export.
 */
export type ResourceTypeResolver = (value: unknown) => ResourceTypeReference | undefined;

/**
 * A loaded module namespace together with the file it was imported from.
 */
export type ResourceModuleNamespace = Readonly<{
  file: string;
  namespace: Record<string, unknown>;
}>;

/**
 * Called with the dotted path of every field that could not be mapped
 * (for example `200.body.user`).
 */
export type UnmappedResourceHandler = (fieldPath: string) => void;

const CORE_PACKAGE = "@warlock.js/core";

function isIndexFile(file: string): boolean {
  return /(^|[\\/])index\.[cm]?[jt]sx?$/.test(file);
}

/**
 * Build an identity map from every function export (resource classes) to the module
 * export it came from.
 *
 * When the same value is exported more than once (a barrel re-export, or a default next
 * to a named export) the most specific location wins: a non-`index.*` file beats an
 * `index.*` file, then a named export beats `default`, then the first one seen.
 */
export function buildResourceMap(
  namespaces: readonly ResourceModuleNamespace[],
): Map<unknown, ResourceModuleExport> {
  const map = new Map<unknown, ResourceModuleExport>();

  const rank = (location: ResourceModuleExport): number =>
    (isIndexFile(location.file) ? 2 : 0) + (location.exportName === "default" ? 1 : 0);

  for (const { file, namespace } of namespaces) {
    for (const [exportName, value] of Object.entries(namespace)) {
      if (typeof value !== "function") continue;

      const candidate: ResourceModuleExport = { file, exportName };
      const existing = map.get(value);

      if (!existing || rank(candidate) < rank(existing)) {
        map.set(value, candidate);
      }
    }
  }

  return map;
}

/**
 * Turn a resource map into a resolver whose import paths are relative to
 * `<appRoot>/.warlock/typings/`, the folder the generated declarations live in.
 */
export function createResourceTypeResolver(
  map: ReadonlyMap<unknown, ResourceModuleExport>,
  appRoot: string,
): ResourceTypeResolver {
  const typingsDirectory = `${appRoot}${sep}.warlock${sep}typings`;

  return (value) => {
    const location = map.get(value);

    if (!location) return undefined;

    let importPath = relative(typingsDirectory, location.file)
      .split(sep)
      .join(posix.sep)
      .replace(/\.[cm]?[jt]sx?$/, "");

    if (!importPath.startsWith(".")) {
      importPath = `./${importPath}`;
    }

    return { importPath, exportName: location.exportName };
  };
}

function describeCast(cast: string): string {
  return `import(${JSON.stringify(CORE_PACKAGE)}).CastOutput<${JSON.stringify(cast)}>`;
}

function describeResource(reference: ResourceTypeReference): string {
  return (
    `import(${JSON.stringify(CORE_PACKAGE)}).ResourceOutput<` +
    `typeof import(${JSON.stringify(reference.importPath)})[${JSON.stringify(reference.exportName)}]>`
  );
}

function describeBodyValue(
  value: unknown,
  path: string,
  resolveResource: ResourceTypeResolver,
  onUnmapped: UnmappedResourceHandler | undefined,
): string {
  if (typeof value === "string") {
    return describeCast(value);
  }

  if (typeof value === "function") {
    const reference = resolveResource(value);

    if (!reference) {
      onUnmapped?.(path);
      return "unknown";
    }

    return describeResource(reference);
  }

  if (Array.isArray(value)) {
    return `(${describeBodyValue(value[0], path, resolveResource, onUnmapped)})[]`;
  }

  if (typeof value === "object" && value !== null) {
    const members = Object.entries(value).map(
      ([key, member]) =>
        `${JSON.stringify(key)}: ${describeBodyValue(member, `${path}.${key}`, resolveResource, onUnmapped)}`,
    );

    return members.length === 0 ? "{}" : `{ ${members.join("; ")} }`;
  }

  return "unknown";
}

/**
 * Serialize a route's `responseSchema` into TypeScript type expressions, one per status code.
 *
 * The expressions are self-contained: they reference only `CastOutput` and `ResourceOutput`
 * from `@warlock.js/core`, `typeof import(...)` of resource modules, object literal types
 * and arrays. A resource that `resolveResource` cannot map becomes `unknown` and is
 * reported through `onUnmapped`.
 *
 * Both the typings child process and the dev server call this, so their output matches.
 *
 * @returns `undefined` when the schema declares no status code.
 *
 * @example
 * describeResponseSchemaTypes({ 400: { body: { error: "string" } } }, resolve);
 * // { "400": '{ "error": import("@warlock.js/core").CastOutput<"string"> }' }
 */
export function describeResponseSchemaTypes(
  schema: unknown,
  resolveResource: ResourceTypeResolver,
  onUnmapped?: UnmappedResourceHandler,
): Record<string, string> | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;

  const described: Record<string, string> = {};

  for (const [status, entry] of Object.entries(schema)) {
    if (typeof entry !== "object" || entry === null) continue;

    const body = (entry as { body?: unknown }).body;

    if (typeof body !== "object" || body === null) continue;

    described[status] = describeBodyValue(body, `${status}.body`, resolveResource, onUnmapped);
  }

  return Object.keys(described).length === 0 ? undefined : described;
}
