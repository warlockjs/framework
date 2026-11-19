import { useMemo } from "react";

/**
 * Series colours of the AI charts. Six categorical slots plus a gray for the
 * summed "Other" series; the tokens live in `styles.css` and are validated for
 * both themes. A series keeps its slot (colour follows the entity, never its
 * rank), so a filter or a range change never repaints the survivors.
 */

export const SERIES_SLOTS = 6;

/** The CSS colour of slot `1` to `6`. */
export function slotColor(slot: number): string {
  return `var(--series-${slot})`;
}

/** The gray of the summed "Other" series. */
export const OTHER_COLOR = "var(--series-other)";

/** The Tokens chart uses fixed slots: uncached input, cached input, output. */
export const TOKEN_SERIES_COLORS: Record<string, string> = {
  uncached: slotColor(1),
  cached: slotColor(2),
  output: slotColor(3),
};

export const SERIES_STORAGE_KEY = "devtools.ai.series";

/**
 * Which slot pool a chart draws from. Models and error categories never share
 * slots, so showing the five error categories cannot evict a model's colour.
 */
export type SeriesNamespace = "models" | "errors";

/** The `sessionStorage` key of a namespace's slots (`models` keeps the original key). */
export function seriesStorageKey(namespace: SeriesNamespace): string {
  return namespace === "models" ? SERIES_STORAGE_KEY : `${SERIES_STORAGE_KEY}.${namespace}`;
}

/** The remembered assignment: `slots` maps a key to its slot, `order` lists keys from least to most recently shown. */
export type SeriesSlots = { slots: Record<string, number>; order: string[] };

export const EMPTY_SLOTS: SeriesSlots = { slots: {}, order: [] };

/**
 * Gives every key a slot. A known key keeps its slot; a new key takes the next
 * free one; when all six are taken it reuses the slot of the least recently
 * shown key that is not in `keys`. Pure: returns a new assignment.
 */
export function assignSeriesSlots(previous: SeriesSlots, keys: readonly string[]): SeriesSlots {
  const slots = { ...previous.slots };
  let order = previous.order.filter((key) => key in slots);

  for (const key of keys) {
    if (!(key in slots)) {
      const used = new Set(Object.values(slots));
      let slot = 1;

      while (slot <= SERIES_SLOTS && used.has(slot)) slot += 1;

      if (slot > SERIES_SLOTS) {
        const evicted = order.find((candidate) => !keys.includes(candidate)) ?? order[0];

        if (evicted === undefined) continue;

        slot = slots[evicted] ?? 1;
        delete slots[evicted];
        order = order.filter((candidate) => candidate !== evicted);
      }

      slots[key] = slot;
    }

    order = [...order.filter((candidate) => candidate !== key), key];
  }

  return { slots, order };
}

function readSlots(storageKey: string): SeriesSlots {
  try {
    const raw = sessionStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<SeriesSlots>) : null;

    if (parsed && parsed.slots && Array.isArray(parsed.order)) {
      return { slots: parsed.slots, order: parsed.order };
    }
  } catch {
    // Storage can be blocked or hold something else; start empty.
  }

  return EMPTY_SLOTS;
}

function writeSlots(storageKey: string, value: SeriesSlots): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // The colours still work for this render; they just are not remembered.
  }
}

/**
 * The colour of each series key, stable across filters, ranges and charts of
 * the session (kept in `sessionStorage`, one pool per `namespace`). `Other`
 * series are not passed in: they always use `OTHER_COLOR`.
 */
export function useSeriesColors(
  keys: readonly string[],
  namespace: SeriesNamespace = "models",
): (key: string) => string {
  const id = `${namespace}\u0001${keys.join("\u0000")}`;

  return useMemo(() => {
    const storageKey = seriesStorageKey(namespace);
    const next = assignSeriesSlots(readSlots(storageKey), keys);

    writeSlots(storageKey, next);

    return (key: string) => slotColor(next.slots[key] ?? 1);
    // `id` stands for `keys` and `namespace`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}
