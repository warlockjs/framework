/** What {@link insertQueueDashboardBlock} did, or could not do, to the source it was given. */
export type DashboardBlockInsertion =
  | { status: "added"; next: string }
  | { status: "already-present" }
  | { status: "unrecognised" };

/** The property this module inserts into `src/config/queue.ts`'s `queueConfig` object. */
/**
 * Enabled outside production only, because the dashboard can retry and delete
 * jobs: `queueConnector()` refuses to mount it in production with an empty
 * `middleware` list. A flat `enabled: true` would therefore stop a freshly
 * generated app from starting in production at all — add a guard middleware,
 * then enable it everywhere.
 */
const DASHBOARD_BLOCK =
  "  // Add a guard middleware, then enable this in production too.\n" +
  '  dashboard: { enabled: process.env.NODE_ENV !== "production", path: "/admin/queues", middleware: [] },\n';

/**
 * Insert the `dashboard` property into the `queueConfig` object literal of
 * `src/config/queue.ts` SOURCE TEXT.
 *
 * **String surgery, never parse-and-print** — same rationale as
 * `insertConnectorEntry`: the config is app-owned and may carry formatting or
 * comments a parse-and-print would discard.
 *
 * A `dashboard` property already present anywhere in the source (by key, so
 * one a human has since hand-edited is still found) is left unchanged — that
 * is what makes a second `warlock add bull-board` a no-op instead of a
 * duplicate block.
 *
 * @param source The config file's current text.
 * @returns What happened, and the new text when there is any.
 */
export function insertQueueDashboardBlock(source: string): DashboardBlockInsertion {
  if (/\bdashboard\s*:/.test(source)) {
    return { status: "already-present" };
  }

  const declaration = /const\s+queueConfig\s*:\s*QueueConfig\s*=\s*\{/.exec(source);

  if (!declaration) {
    return { status: "unrecognised" };
  }

  const bodyStart = declaration.index + declaration[0].length;
  const closingBraceIndex = findMatchingBraceIndex(source, bodyStart);

  if (closingBraceIndex === -1) {
    return { status: "unrecognised" };
  }

  return {
    status: "added",
    next: `${source.slice(0, closingBraceIndex)}${DASHBOARD_BLOCK}${source.slice(closingBraceIndex)}`,
  };
}

/**
 * Find the index of the `}` that closes the object literal whose `{` sits
 * right before `bodyStart`, accounting for nested `{ }` pairs (`connection:
 * {...}`, `workers: {...}`, …).
 */
function findMatchingBraceIndex(source: string, bodyStart: number): number {
  let depth = 1;

  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}") {
      depth--;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}
