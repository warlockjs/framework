import type { DevtoolsCallerLocation, DevtoolsQuery, DevtoolsWarning } from "./types";

/** Finds repeated query shapes whose occurrence count reaches the supplied threshold. */
export function detectNPlusOne(queries: DevtoolsQuery[], threshold: number): DevtoolsWarning[] {
  const groups = new Map<string, DevtoolsQuery[]>();
  for (const query of queries) groups.set(query.shape, [...(groups.get(query.shape) ?? []), query]);

  return [...groups.entries()]
    .filter(([, grouped]) => grouped.length >= threshold)
    .sort(([, left], [, right]) => right.length - left.length)
    .map(([shape, grouped]) => ({
      type: "n+1" as const,
      shape,
      count: grouped.length,
      message: `N+1: ${grouped.length}× "${truncate(shape, 120)}"`,
      ...(mostFrequentCaller(grouped) ? { caller: mostFrequentCaller(grouped) } : {}),
    }));
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

function mostFrequentCaller(queries: DevtoolsQuery[]): DevtoolsCallerLocation | undefined {
  const callers = new Map<string, { caller: DevtoolsCallerLocation; count: number }>();
  for (const query of queries) {
    if (!query.caller) continue;
    const key = `${query.caller.file}:${query.caller.line}`;
    const found = callers.get(key);
    callers.set(
      key,
      found ? { ...found, count: found.count + 1 } : { caller: query.caller, count: 1 },
    );
  }
  return [...callers.values()].sort((left, right) => right.count - left.count)[0]?.caller;
}
