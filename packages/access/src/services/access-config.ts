import { config } from "@warlock.js/core";
import type { AccessResolver } from "../contracts/access-resolver";
import type { RolesMap } from "../contracts/types";
import { DefaultAccessResolver } from "./default-resolver";

let cachedDefaultResolver: AccessResolver | undefined;

/** Accessors for `config.access.*`, each with a sensible default. */
export const accessConfig = {
  /** role → permissions map (code catalog). */
  roles(): RolesMap {
    return config.key("access.roles", {}) as RolesMap;
  },

  /**
   * The active resolver — an app-provided one, or the built-in
   * `DefaultAccessResolver` over the `roles` map (built once, memoised).
   */
  resolver(): AccessResolver {
    const configured = config.key("access.resolver", undefined) as AccessResolver | undefined;

    if (configured) return configured;

    if (!cachedDefaultResolver) {
      cachedDefaultResolver = new DefaultAccessResolver(this.roles());
    }

    return cachedDefaultResolver;
  },

  /** Cache TTL for resolved permission sets. */
  cacheTtl(): string | number {
    return config.key("access.cacheTtl", "10m") as string | number;
  },

  /** Resolve the ambient tenant, if a hook is configured. */
  tenant(): string | undefined {
    const resolve = config.key("access.tenant.resolve", undefined) as
      | (() => string | undefined)
      | undefined;

    return resolve ? resolve() : undefined;
  },
};

/** Reset the memoised default resolver — for tests that swap config between cases. */
export function resetAccessConfig(): void {
  cachedDefaultResolver = undefined;
}
