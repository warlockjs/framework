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
  /** Tenant scope. Defaults to the resolver's optional `resolveTenant()`. */
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

export type AccessConfigurations = {
  /**
   * REQUIRED. The adapter that reads a user's roles + permissions (and,
   * optionally, the ambient tenant). The role→permission catalog lives INSIDE
   * the resolver — there is no separate config map.
   */
  resolver: AccessResolver;

  /** Cache settings for resolved permission sets. */
  cache?: {
    /** TTL for a cached set. @default "10m" */
    ttl?: string | number;
  };

  /**
   * When `true` (the default), an instance-level check (a `resource` was
   * supplied) for a permission with no registered ABAC policy DENIES instead
   * of falling back to the RBAC grant alone — a forgotten `definePolicy` call
   * must never fail open. The miss is logged once per permission via the
   * package's logger.
   *
   * Set to `false` to explicitly restore the pre-5.13 behavior: fall back to
   * the RBAC grant alone (ALLOWS — a plausible IDOR if the permission was
   * meant to be resource-scoped). Still warns once per permission.
   *
   * @default true
   */
  strictPolicies?: boolean;
};
