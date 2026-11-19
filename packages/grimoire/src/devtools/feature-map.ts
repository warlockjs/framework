/**
 * What the tabbed feature page draws beyond the scry answer: the feature map
 * (flows by the places they run), the own files by module and the proof of
 * each flow. Built from the step matches the book maps already hold; no step
 * is resolved again.
 */
import { normalizeRoutePath } from "../bookmap";
import type { FlowBookmapStep } from "../contracts/bookmap";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { WrittenApp, WrittenFeature, WrittenPage, WrittenStep } from "../contracts/written";
import { flowOrder } from "../scry/compact";
import type {
  GrimoireFeatureFileGroup,
  GrimoireFeatureMap,
  GrimoireFeatureMapChip,
  GrimoireFeatureMapColumn,
  GrimoireFeatureProof,
} from "./answers";

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const BACKGROUND = new Set(["mail", "job", "event", "notification"]);

/** Which written app each page, setup or screen file belongs to (only the apps asked for). */
function fileApps(snapshot: GrimoireSnapshot, wanted: ReadonlySet<string>): Map<string, string> {
  const owners = new Map<string, string>();

  for (const [appId, match] of Object.entries(snapshot.apps)) {
    if (!wanted.has(appId)) continue;

    if (match.site) {
      for (const page of snapshot.book.facts.pages) {
        if (page.site !== match.site.id) continue;

        owners.set(page.file, appId);
        if (page.setupFile !== null) owners.set(page.setupFile, appId);
      }
    }

    for (const screen of match.mobile?.screens ?? []) owners.set(screen.file, appId);
  }

  return owners;
}

function writtenPage(app: WrittenApp | undefined, route: string): WrittenPage | undefined {
  if (app === undefined) return undefined;

  const wanted = normalizeRoutePath(route);

  return [...app.pages, ...app.screens].find((page) => {
    const own = page.route?.value ?? page.screen?.value ?? null;

    return own !== null && normalizeRoutePath(own) === wanted;
  });
}

/** The feature map of one feature. */
export function featureMap(
  snapshot: GrimoireSnapshot,
  feature: WrittenFeature,
): GrimoireFeatureMap {
  const apps = new Map(snapshot.written.apps.map((app) => [app.id.value, app]));
  const appIds = new Set((feature.readme?.apps ?? []).map((app) => app.value));

  for (const flow of feature.flows)
    for (const step of flow.steps) if (step.app) appIds.add(step.app);

  const owners = fileApps(snapshot, appIds);
  const firstSite = [...appIds].find((id) => apps.get(id)?.type.value === "site") ?? null;
  const columns = new Map<string, GrimoireFeatureMapColumn>();
  const rows: GrimoireFeatureMap["rows"] = [];

  const columnOf = (id: string, title: string, type: GrimoireFeatureMapColumn["type"]): string => {
    if (!columns.has(id)) columns.set(id, { id, title, type });

    return id;
  };

  const appColumn = (appId: string): string => {
    const app = apps.get(appId);

    return columnOf(
      `app:${appId}`,
      app?.heading?.value ?? appId,
      app?.type.value ?? snapshot.apps[appId]?.type ?? "site",
    );
  };

  for (const flow of flowOrder(feature)) {
    const steps: readonly FlowBookmapStep[] = snapshot.collected.flows[flow.ref]?.steps ?? [];
    const written = new Map<number, WrittenStep>(flow.steps.map((step) => [step.index, step]));
    const cells: Record<string, GrimoireFeatureMapChip[]> = {};
    const add = (column: string, chip: GrimoireFeatureMapChip): void => {
      const cell = (cells[column] ??= []);

      if (!cell.some((item) => item.label === chip.label && item.type === chip.type))
        cell.push(chip);
    };

    for (const step of steps) {
      const source = written.get(step.index);
      const entry = step.entry ?? null;
      const base = { step: step.index, type: step.type, found: step.found, file: entry };

      if (step.type === "route") {
        const method = source?.route?.method ?? null;
        const path = source?.route?.path ?? null;

        add(columnOf("api", "API", "api"), {
          ...base,
          label: method === null || path === null ? step.target : `${method} ${path}`,
          app: null,
          page: null,
          method,
          path,
        });
      } else if (step.type === "page") {
        const route = source?.target ?? step.target;
        const scoped = source?.app ?? null;
        const matched = step.entries.map((file) => owners.get(file)).find((id) => id !== undefined);
        const appId = scoped ?? matched ?? firstSite;
        const column = appId === null ? columnOf("other", "Not placed", "other") : appColumn(appId);

        add(column, {
          ...base,
          label: route,
          app: appId,
          page: appId === null ? null : (writtenPage(apps.get(appId), route)?.id ?? null),
          method: null,
          path: null,
        });
      } else if (BACKGROUND.has(step.type)) {
        add(columnOf("background", "Background", "background"), {
          ...base,
          label: source?.target ?? step.target,
          app: null,
          page: null,
          method: null,
          path: null,
        });
      }
    }

    rows.push({
      flow: flow.id.value,
      heading: flow.heading?.value ?? null,
      status: flow.status.value,
      cells,
    });
  }

  const rank = (column: GrimoireFeatureMapColumn): number =>
    column.type === "site"
      ? 0
      : column.type === "mobile"
        ? 1
        : column.type === "api"
          ? 2
          : column.type === "background"
            ? 3
            : 4;

  return {
    columns: [...columns.values()].sort(
      (left, right) => rank(left) - rank(right) || byText(left.title, right.title),
    ),
    rows,
  };
}

/** The feature's own files grouped by module (modules and files sorted). */
export function featureFileGroups(
  snapshot: GrimoireSnapshot,
  own: readonly string[],
): GrimoireFeatureFileGroup[] {
  const modules = new Map(snapshot.book.facts.files.map((item) => [item.file, item.module]));
  const groups = new Map<string, string[]>();

  for (const file of own) {
    const module = modules.get(file) ?? "";

    groups.set(module, [...(groups.get(module) ?? []), file]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => byText(left, right))
    .map(([module, files]) => ({ module, files: [...files].sort(byText) }));
}

/** The criteria of each flow with the tests behind them, in the README's flow order. */
export function featureProofs(
  snapshot: GrimoireSnapshot,
  feature: WrittenFeature,
): GrimoireFeatureProof[] {
  return flowOrder(feature).map((flow) => ({
    flow: flow.id.value,
    heading: flow.heading?.value ?? null,
    criteria: snapshot.collected.flows[flow.ref]?.criteria ?? [],
  }));
}
