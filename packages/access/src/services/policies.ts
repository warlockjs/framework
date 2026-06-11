import type { PolicyFn } from "../contracts/types";

const policies = new Map<string, PolicyFn>();

/**
 * Register an ABAC condition for a permission. It runs ON TOP of the RBAC grant
 * whenever an authorization check carries a `resource` — letting you express
 * "...but only their own / only in their tenant / only while pending".
 *
 * @example
 * definePolicy("orders.update", (user, order) => order.get("customer_id") === user.id);
 */
export function definePolicy(permission: string, policy: PolicyFn): void {
  policies.set(permission, policy);
}

/** The policy registered for a permission, if any. */
export function getPolicy(permission: string): PolicyFn | undefined {
  return policies.get(permission);
}

/** Remove every registered policy. Primarily for tests. */
export function clearPolicies(): void {
  policies.clear();
}
