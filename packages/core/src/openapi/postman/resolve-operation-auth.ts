import type { OpenApiComponents, OpenApiOperation, OpenApiSecurityScheme } from "../types";
import type { PostmanAuth } from "./postman-types";

export type OperationAuth = {
  /** Set only when the operation must not inherit the collection auth. */
  auth?: PostmanAuth;
  /** Text appended to the request description. */
  note?: string;
};

/** The collection-level auth: a bearer token read from the `{{token}}` variable. */
export function collectionBearerAuth(): PostmanAuth {
  return { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] };
}

function isBearer(scheme: OpenApiSecurityScheme | undefined): boolean {
  return scheme?.type === "http" && scheme.scheme.toLowerCase() === "bearer";
}

/**
 * Whether the document declares an HTTP bearer scheme, which is what the collection-level
 * auth stands for.
 */
export function hasBearerScheme(components: OpenApiComponents | undefined): boolean {
  return Object.values(components?.securitySchemes ?? {}).some(isBearer);
}

/**
 * How one operation relates to the collection-level bearer auth.
 *
 * - No `security` (a public route): `noauth`, so the token is not sent.
 * - A bearer requirement: inherits the collection auth.
 * - Cookie-only: `noauth` plus a note, because Postman keeps cookies per domain instead of
 *   in collection auth.
 */
export function resolveOperationAuth(
  operation: OpenApiOperation,
  components: OpenApiComponents | undefined,
): OperationAuth {
  const bearerDocument = hasBearerScheme(components);
  const schemes = components?.securitySchemes ?? {};
  const names = (operation.security ?? []).flatMap((requirement) => Object.keys(requirement));

  if (names.some((name) => isBearer(schemes[name]))) {
    return {};
  }

  const cookies = names.flatMap((name) => {
    const scheme = schemes[name];

    return scheme?.type === "apiKey" && scheme.in === "cookie" ? [scheme.name] : [];
  });

  const auth = bearerDocument ? { auth: { type: "noauth" } as const } : {};

  if (cookies.length === 0) {
    return auth;
  }

  const cookieList = cookies.map((cookie) => `"${cookie}"`).join(", ");

  return {
    ...auth,
    note: `Authenticates with the ${cookieList} cookie. Postman keeps cookies per domain, so sign in against {{baseUrl}} first or add the cookie in the Cookies manager.`,
  };
}
