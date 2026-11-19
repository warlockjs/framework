import type { ComponentType } from "react";
import {
  ArrowLeftRightIcon,
  BookMarkedIcon,
  BookOpenIcon,
  BotIcon,
  BoxesIcon,
  BugIcon,
  ChartColumnIcon,
  ClipboardCheckIcon,
  CpuIcon,
  DatabaseIcon,
  GaugeIcon,
  HeartPulseIcon,
  ListChecksIcon,
  MailIcon,
  PuzzleIcon,
  RouteIcon,
  ScrollTextIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";

export type NavIcon = ComponentType<{ className?: string }>;

/** Icons for the known tab ids; any other package panel gets the puzzle piece. */
const ICONS: Record<string, NavIcon> = {
  requests: ArrowLeftRightIcon,
  queries: DatabaseIcon,
  routes: RouteIcon,
  resources: GaugeIcon,
  health: HeartPulseIcon,
  errors: BugIcon,
  logs: ScrollTextIcon,
  jobs: ListChecksIcon,
  mail: MailIcon,
  "ai-reports": ChartColumnIcon,
  ai: SparklesIcon,
  agents: BotIcon,
  "ai-models": BoxesIcon,
  "ai-errors": TriangleAlertIcon,
  "ai-evaluate": ClipboardCheckIcon,
  api: BookOpenIcon,
  processes: CpuIcon,
  grimoire: BookMarkedIcon,
};

export function iconFor(id: string): NavIcon {
  return ICONS[id] ?? PuzzleIcon;
}

export const NAV_GROUPS = ["Monitor", "Application", "AI", "Packages"] as const;

export type NavGroup = (typeof NAV_GROUPS)[number];

/** The section of each built-in tab, in the order the tabs are listed inside it. */
const SECTIONS: Record<string, NavGroup> = {
  requests: "Monitor",
  queries: "Monitor",
  errors: "Monitor",
  logs: "Monitor",
  health: "Monitor",
  resources: "Monitor",
  processes: "Monitor",
  routes: "Application",
  jobs: "Application",
  mail: "Application",
  api: "Application",
  "ai-reports": "AI",
  ai: "AI",
  agents: "AI",
  "ai-models": "AI",
  "ai-errors": "AI",
  "ai-evaluate": "AI",
};

/** Whether a tab id sits in the AI sidebar group. */
export function isAiTab(id: string | null): boolean {
  return id !== null && SECTIONS[id] === "AI";
}

const ORDER = Object.keys(SECTIONS);

export type NavEntry<T extends { id: string }> = { group: NavGroup; items: T[] };

/** Splits the panels into the sidebar sections; panels that are not built in go under Packages. */
export function groupPanels<T extends { id: string }>(panels: readonly T[]): NavEntry<T>[] {
  const byGroup = new Map<NavGroup, T[]>();

  for (const panel of panels) {
    const group = SECTIONS[panel.id] ?? "Packages";

    byGroup.set(group, [...(byGroup.get(group) ?? []), panel]);
  }

  return NAV_GROUPS.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    items: [...(byGroup.get(group) ?? [])].sort((a, b) => {
      const left = ORDER.indexOf(a.id);
      const right = ORDER.indexOf(b.id);

      return (left === -1 ? Infinity : left) - (right === -1 ? Infinity : right);
    }),
  }));
}
