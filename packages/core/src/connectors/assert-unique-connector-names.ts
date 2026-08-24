/**
 * Refuses a `connectors` array that lists the same name more than once.
 *
 * A name is a connector's identity across both halves of its life, and the two
 * halves treat a repeat differently. The build works per ARRAY ENTRY: it drains
 * the build contribution of every element, so a name listed twice contributes
 * twice — files written twice, esbuild patches merged twice. The runtime works
 * per NAME: the first entry registers and every later one with that name is
 * skipped, because registering it again would boot and shut down the same
 * connector twice.
 *
 * So a duplicate is half-applied: built for twice, booted once, with nothing
 * reported either way. The name-set the drift check compares is identical on
 * both sides, so it passes the array straight through — this asymmetry is
 * invisible to it, which is why it is caught here instead.
 *
 * Called by both halves (the build before it drains, the registration before it
 * registers) so neither can be reached with an array the other would refuse.
 * It rejects duplicates WITHIN the array it is handed. A name held OUTSIDE the
 * array is out of scope here: if a BUILT-IN holds it, the reserved-name check
 * refuses it; if an EARLIER CALL configured it, the registration skip treats it
 * as idempotency on purpose — neither validator claims that case.
 */
import type { Connector } from "./types";

export function assertUniqueConnectorNames(connectors: Connector[]): void {
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const connector of connectors) {
    if (seen.has(connector.name)) {
      duplicated.add(connector.name);
      continue;
    }

    seen.add(connector.name);
  }

  if (duplicated.size === 0) return;

  const names = [...duplicated].map((name) => JSON.stringify(name)).join(", ");
  const subject = duplicated.size === 1 ? "name is" : "names are";

  throw new Error(
    `The same connector ${subject} listed more than once in \`connectors\`: [${names}].\n` +
      "Every connector in `warlock.config.ts > connectors` must have a unique name. " +
      "The build prepares artifacts per ENTRY — it drains the build contribution of each one, so a repeated name contributes twice — " +
      "while the runtime registers each NAME once and skips the rest. " +
      "A duplicate is therefore half-applied, and neither half reports it. " +
      "Remove the extra entry, or give the connectors distinct names.",
  );
}
