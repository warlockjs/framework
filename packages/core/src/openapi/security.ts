import type {
  AuthDescriptor,
  OpenApiSecurityRequirement,
  OpenApiSecurityScheme,
  WarningSink,
} from "./types";

/**
 * The marker `authMiddleware()` attaches to the middleware it returns.
 * Core reads it structurally; it never imports the auth package.
 */
export const AUTH_DESCRIPTOR_SYMBOL = Symbol.for("warlock.auth");

function isAuthSource(value: unknown): value is AuthDescriptor["sources"][number] {
  if (value === "header") {
    return true;
  }

  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { cookie?: unknown }).cookie === "string" &&
    (value as { cookie: string }).cookie.length > 0
  );
}

/**
 * Validate an auth descriptor. Returns `undefined` for anything that is not
 * `{ sources: ("header" | { cookie: string })[], userTypes?: string[] }` with at least one source.
 */
export function parseAuthDescriptor(value: unknown): AuthDescriptor | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const { sources, userTypes, required } = value as {
    sources?: unknown;
    userTypes?: unknown;
    required?: unknown;
  };
  if (required !== undefined && typeof required !== "boolean") return undefined;

  if (!Array.isArray(sources) || sources.length === 0 || !sources.every(isAuthSource)) {
    return undefined;
  }

  if (
    userTypes !== undefined &&
    !(Array.isArray(userTypes) && userTypes.every((type) => typeof type === "string"))
  ) {
    return undefined;
  }

  return {
    sources: [...sources],
    userTypes: Array.isArray(userTypes) ? [...userTypes] : [],
    ...(required === undefined ? {} : { required }),
  };
}

/**
 * Combine the descriptors of every guard on a route (group middleware is already merged into
 * the route): unique sources, union of user types.
 *
 * Middleware without a descriptor is ordinary middleware and is ignored silently. A function
 * that carries a descriptor of the wrong shape is reported through `warn`.
 *
 * @returns `undefined` when the route has no valid auth descriptor.
 */
export function readRouteAuth(middleware: unknown, warn: WarningSink): AuthDescriptor | undefined {
  if (!Array.isArray(middleware)) {
    return undefined;
  }

  const sources: AuthDescriptor["sources"] = [];
  const userTypes: string[] = [];
  let found = false;
  let required = false;
  let hasRequiredFlag = false;

  for (const fn of middleware) {
    if (typeof fn !== "function") {
      continue;
    }

    const raw = Reflect.get(fn, AUTH_DESCRIPTOR_SYMBOL);

    if (raw === undefined) {
      continue;
    }

    const descriptor = parseAuthDescriptor(raw);

    if (!descriptor) {
      warn(
        "a middleware carries a malformed warlock.auth descriptor; the route is documented without security.",
      );

      continue;
    }

    found = true;
    required ||= descriptor.required !== false;
    hasRequiredFlag ||= descriptor.required !== undefined;

    for (const source of descriptor.sources) {
      const duplicate = sources.some((existing) =>
        typeof existing === "string" || typeof source === "string"
          ? existing === source
          : existing.cookie === source.cookie,
      );

      if (!duplicate) {
        sources.push(source);
      }
    }

    for (const type of descriptor.userTypes) {
      if (!userTypes.includes(type)) {
        userTypes.push(type);
      }
    }
  }

  return found ? { sources, userTypes, ...(hasRequiredFlag ? { required } : {}) } : undefined;
}

/**
 * Collects the security schemes the routes actually use and turns descriptors into
 * per-operation requirements. A dual header + cookie guard is an OR: one requirement each.
 */
export class SecuritySchemes {
  public readonly schemes: Record<string, OpenApiSecurityScheme> = {};

  private readonly cookieSchemeNames = new Map<string, string>();

  public requirementsFor(descriptor: AuthDescriptor): OpenApiSecurityRequirement[] {
    const requirements: OpenApiSecurityRequirement[] = descriptor.sources.map((source) => {
      if (source === "header") {
        this.schemes.bearerAuth = { type: "http", scheme: "bearer", bearerFormat: "JWT" };

        return { bearerAuth: [] };
      }

      const name = this.cookieScheme(source.cookie);

      return { [name]: [] };
    });
    return descriptor.required === false ? [...requirements, {}] : requirements;
  }

  private cookieScheme(cookie: string): string {
    const existing = this.cookieSchemeNames.get(cookie);

    if (existing) {
      return existing;
    }

    // The first cookie keeps the conventional name; a second, different cookie gets its own.
    const name =
      this.cookieSchemeNames.size === 0
        ? "cookieAuth"
        : `cookieAuth_${cookie.replace(/[^A-Za-z0-9._-]/g, "")}`;

    this.cookieSchemeNames.set(cookie, name);
    this.schemes[name] = { type: "apiKey", in: "cookie", name: cookie };

    return name;
  }

  public hasSchemes(): boolean {
    return Object.keys(this.schemes).length > 0;
  }
}
