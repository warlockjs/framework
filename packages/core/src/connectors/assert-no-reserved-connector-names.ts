/**
 * Refuses a `connectors` array that claims a name a framework built-in owns.
 *
 * The uniqueness check rejects a name repeated inside the array; this rejects
 * one already held by a BUILT-IN outside it. The manager registers its
 * built-ins in its own constructor, so those names are taken before any config
 * is read — and the two halves disagreed about what that meant. The build
 * drains per ENTRY and knows nothing of the manager, so it prepared the custom
 * connector's artifacts; the runtime registers per NAME and found the built-in
 * already there, so it skipped the entry. The result booted the built-in the
 * app did not ask for, never booted the connector it did, and reported success
 * from both halves.
 *
 * Refused rather than resolved in the app's favour: the built-ins are the
 * framework's own wiring — other framework code reaches for `http`, `cache`,
 * `database` by name — so letting a config replace one silently repoints
 * everything that looks it up. The name is the app's to change; the built-in's
 * is not.
 *
 * Scope, precisely: BUILT-IN names only. A name held by a PREVIOUSLY
 * CONFIGURED connector (an earlier call in the same process) is not this
 * check's business — that case is the registration skip's deliberate
 * idempotency, and stays out of both validators.
 *
 * Reads {@link ConnectorsManager.isBuiltInName}, which is the ONLY inventory of
 * built-in names, so this cannot fall out of step with what the manager
 * actually registered.
 */
import { connectorsManager } from "./connectors-manager";
import type { Connector } from "./types";

export function assertNoReservedConnectorNames(connectors: Connector[]): void {
  const reserved = connectors
    .map((connector) => connector.name)
    .filter((name) => connectorsManager.isBuiltInName(name));

  if (reserved.length === 0) return;

  const unique = [...new Set(reserved)];
  const names = unique.map((name) => JSON.stringify(name)).join(", ");
  const subject = unique.length === 1 ? "name is" : "names are";
  const object = unique.length === 1 ? "it" : "one of them";

  throw new Error(
    `The following connector ${subject} reserved by a framework built-in connector: [${names}].\n` +
      "Every connector name must be unique, and the framework already registers a built-in connector under " +
      `${unique.length === 1 ? "that name" : "those names"}, so a custom connector carrying ${object} ` +
      "would be built for and then never booted. " +
      "Rename the custom connector in `warlock.config.ts > connectors` to a name of your own.",
  );
}
