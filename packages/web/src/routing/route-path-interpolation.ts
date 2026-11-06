import { parseMixedSegment, namedWildcardOfSegment } from "./mixed-route-segment";
import { parseRoutePathParameters } from "./route-path-parameters";

/** Values accepted by the runtime route interpolator. */
export type RoutePathInterpolationParameters = Readonly<Record<string, unknown>>;

/**
 * Keeps package-specific public errors at the call site while sharing the
 * browser-safe interpolation algorithm between page links and form targets.
 */
export type RoutePathInterpolationOptions = {
  readonly onMissingParameter: (name: string) => never;
  readonly onUnknownParameters?: (names: readonly string[]) => never;
  readonly rejectUnknownParameters?: boolean;
  readonly isMissing?: (value: unknown) => boolean;
  /**
   * Interpolate page-route shapes precisely: segments that mix params with
   * static text (`/:type-for-:purpose`, each param encoded, text kept) and a
   * named terminal wildcard (`/files/*rest`). Page links turn it on; form and
   * API targets leave it off.
   */
  readonly mixedSegments?: boolean;
};

const PLAIN_PARAMETER = /^:[A-Za-z0-9_]+$/;
const LEGACY_PARAMETER_PATTERN = /:([A-Za-z0-9_]+)|\*/g;

/** A wildcard spans segments, so its `/` separators stay literal. */
function encodeParameterValue(name: string, value: unknown): string {
  if (name !== "*") return encodeURIComponent(String(value));

  return String(value).split("/").map(encodeURIComponent).join("/");
}

function legacyParameterNames(path: string): readonly string[] {
  const names: string[] = [];

  for (const match of path.matchAll(LEGACY_PARAMETER_PATTERN)) names.push(match[1] ?? "*");

  return names;
}

function suppliedNames(
  parameters: RoutePathInterpolationParameters | undefined,
  isMissing: (value: unknown) => boolean,
): readonly string[] {
  return Object.keys(parameters ?? {}).filter((name) => !isMissing(parameters?.[name]));
}

function rejectUnknown(
  declared: readonly string[],
  parameters: RoutePathInterpolationParameters | undefined,
  options: RoutePathInterpolationOptions,
  isMissing: (value: unknown) => boolean,
): void {
  if (!options.rejectUnknownParameters) return;

  const unknown = suppliedNames(parameters, isMissing).filter((name) => !declared.includes(name));

  if (unknown.length > 0) options.onUnknownParameters?.(unknown);
}

function interpolateLegacyPath(
  path: string,
  parameters: RoutePathInterpolationParameters | undefined,
  options: RoutePathInterpolationOptions,
  isMissing: (value: unknown) => boolean,
): string {
  rejectUnknown(legacyParameterNames(path), parameters, options, isMissing);

  return path.replace(LEGACY_PARAMETER_PATTERN, (segment, name: string | undefined) => {
    const value = parameters?.[name ?? "*"];
    if (isMissing(value)) return options.onMissingParameter(name ?? "*");
    return encodeParameterValue(name ?? "*", value);
  });
}

/**
 * Interpolate supported whole-segment grammar precisely. Unsupported router
 * grammar deliberately uses the legacy replacement behavior until that grammar
 * has a matching runtime contract.
 */
export function interpolateRoutePath(
  path: string,
  parameters: RoutePathInterpolationParameters | undefined,
  options: RoutePathInterpolationOptions,
): string {
  const isMissing = options.isMissing ?? ((value: unknown) => value === undefined);
  const mixed = options.mixedSegments === true;
  const parsed = parseRoutePathParameters(path, { mixedSegments: mixed });

  if (parsed.type === "broad") return interpolateLegacyPath(path, parameters, options, isMissing);

  rejectUnknown(
    parsed.parameters.map((parameter) => parameter.name),
    parameters,
    options,
    isMissing,
  );

  const segments = path.split("/");
  const interpolated = segments.flatMap((segment) => {
    if (mixed) {
      const wildcard = namedWildcardOfSegment(segment);

      if (wildcard !== undefined) {
        const value = parameters?.[wildcard];
        if (isMissing(value)) return options.onMissingParameter(wildcard);
        // A named wildcard spans segments just as a bare `*` does.
        return [String(value).split("/").map(encodeURIComponent).join("/")];
      }

      const parts = segment.includes(":") ? parseMixedSegment(segment) : undefined;

      if (parts?.type === "mixed" && !PLAIN_PARAMETER.test(segment)) {
        return [
          parts.parts
            .map((part) => {
              if (part.type === "text") return part.value;
              const value = parameters?.[part.name];
              if (isMissing(value)) return options.onMissingParameter(part.name);
              return encodeURIComponent(String(value));
            })
            .join(""),
        ];
      }
    }

    const parameter = parsed.parameters.find(
      (candidate) =>
        segment ===
        (candidate.name === "*" ? "*" : `:${candidate.name}${candidate.optional ? "?" : ""}`),
    );

    if (parameter === undefined) return [segment];
    const value = parameters?.[parameter.name];
    if (parameter.optional && (value === undefined || value === null)) return [];
    if (isMissing(value)) return options.onMissingParameter(parameter.name);
    return [encodeParameterValue(parameter.name, value)];
  });
  const result = interpolated.join("/");

  return result === "" && path.startsWith("/") ? "/" : result;
}
