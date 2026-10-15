import type { Auth } from "@warlock.js/auth";
import type { AccessResolver } from "../contracts/access-resolver";
import type { AccessConfigurations } from "../contracts/types";
import { AccessConfigError } from "../utils/access-config-error";

/**
 * The active configuration, fed once at boot by the framework's access connector
 * via {@link setAccessConfig} (the connector reads `src/config/access.ts`).
 * Reading it before it's set throws {@link AccessConfigError} — a loud
 * misconfiguration, never a silent deny.
 */
let current: AccessConfigurations | undefined;

/**
 * Register the access configuration. The framework's access connector calls this
 * at boot with the default export of `src/config/access.ts`. It validates that a
 * `resolver` is present, so a misconfigured authorization layer fails at STARTUP
 * rather than on the first protected request.
 *
 * @example
 * setAccessConfig({ resolver: new DefaultAccessResolver({ admin: ["*"] }) });
 */
export function setAccessConfig(configuration: AccessConfigurations): void {
  if (!configuration?.resolver) {
    throw new AccessConfigError(
      "No access resolver configured. Set `resolver` in src/config/access.ts to a class " +
        "implementing AccessResolver — the ejected DatabaseAccessResolver, or " +
        "`new DefaultAccessResolver(rolesMap)` for a fixed-role catalog.",
    );
  }

  current = configuration;
}

/** Clear the active config. Used by the connector on dev-restart and by tests. */
export function resetAccessConfig(): void {
  current = undefined;
}

/** Accessors over the active access configuration. */
export const accessConfig = {
  /**
   * The configured resolver. Throws {@link AccessConfigError} if access was never
   * configured (no `src/config/access.ts`, or the connector hasn't run).
   */
  resolver(): AccessResolver {
    if (!current) {
      throw new AccessConfigError(
        "@warlock.js/access is not configured. Add src/config/access.ts (exporting a `resolver`) " +
          "— it is wired at boot by the access connector.",
      );
    }

    return current.resolver;
  },

  /** Cache TTL for resolved permission sets. */
  cacheTtl(): string | number {
    return current?.cache?.ttl ?? "10m";
  },

  /** Whether an unpoliced instance-level check should deny instead of falling back to the RBAC grant. */
  strictPolicies(): boolean {
    return current?.strictPolicies ?? true;
  },

  /** Ambient tenant for this user, delegated to the resolver's optional hook. */
  tenant(user: Auth): string | undefined {
    return this.resolver().resolveTenant?.(user);
  },
};
