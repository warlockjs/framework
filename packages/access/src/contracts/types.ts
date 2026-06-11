import type { Auth } from "@warlock.js/auth";
import type { AccessResolver } from "./access-resolver";

/** A role name mapped to the permission strings it grants. */
export type RolesMap = Record<string, string[]>;

/**
 * Extra context for an authorization check. `resource` and `tenant` are
 * **reserved** (the engine acts on them); every other key is forwarded to the
 * policy verbatim.
 */
export type AccessContext = {
  /** The object being authorized. Its presence is what enables the ABAC policy. */
  resource?: unknown;
  /** Tenant scope. Defaults to `config.access.tenant.resolve()`. */
  tenant?: string;
  [key: string]: unknown;
};

/** The context a policy receives — the access context plus engine-injected helpers. */
export type PolicyContext = AccessContext & {
  tenant?: string;
  /** Whether the user holds the given role (in the resolved tenant). */
  hasRole: (role: string) => boolean;
  /** Whether the user's effective set covers the given permission. */
  hasPermission: (permission: string) => boolean;
};

/** An ABAC policy: may the user act on this specific resource? */
export type PolicyFn = (
  user: Auth,
  resource: unknown,
  context: PolicyContext,
) => boolean | Promise<boolean>;

/**
 * `config.access.*` shape. Most apps set only `roles` and let the built-in
 * resolver do the rest.
 */
export type AccessConfigurations = {
  /** role → permissions map (your code-defined catalog). */
  roles?: RolesMap;
  /** The resolver. Defaults to `DefaultAccessResolver(roles)`. */
  resolver?: AccessResolver;
  /** Cache TTL for resolved permission sets. @default "10m" */
  cacheTtl?: string | number;
  /** Resolve the ambient tenant when a check doesn't pass one explicitly. */
  tenant?: { resolve?: () => string | undefined };
};
