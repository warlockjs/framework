/**
 * Builds parsed written models and file facts by hand, so unit specs of the
 * ownership and book map code do not depend on the parser or the book.
 */
import type {
  BookFacts,
  BookFile,
  Located,
  WrittenApp,
  WrittenBlockRow,
  WrittenChangelogEntry,
  WrittenFeature,
  WrittenFlow,
  WrittenGrimoire,
  WrittenPage,
  WrittenStep,
  WrittenTask,
  StepType,
} from "../../src/contracts";

export const at = (file = "grimoire/x.md", line = 1) => ({ file, line, column: null });

export function located<T>(value: T, file?: string): Located<T> {
  return { value, at: at(file) };
}

/** A code file with the given imports (importers are filled by {@link facts}). */
export function codeFile(
  file: string,
  imports: string[] = [],
  extra: Partial<BookFile> = {},
): BookFile {
  return {
    file,
    module: file.split("/").slice(0, 3).join("/"),
    type: "source",
    lines: 1,
    about: null,
    tags: {},
    exports: [],
    imports: imports.map((target) => ({ specifier: target, file: target })),
    importedBy: [],
    mobileApp: null,
    ...extra,
  };
}

/** Facts from files (importers computed) and optional other facts. */
export function facts(files: BookFile[], rest: Partial<Omit<BookFacts, "files">> = {}): BookFacts {
  for (const file of files) {
    file.importedBy = files
      .filter((other) => other.imports.some((entry) => entry.file === file.file))
      .map((other) => other.file)
      .sort();
  }

  return { files, routes: [], sites: [], pages: [], mobile: [], named: [], tests: [], ...rest };
}

/** A step line: `route POST /x`, `page /`, `mail welcome`, `affects f/flow`, `outside service bank`. */
export function step(
  index: number,
  type: StepType,
  target: string,
  app: string | null = null,
): WrittenStep {
  const route = type === "route" ? /^(\S+)\s+(\S+)$/.exec(target) : null;
  const [feature = "", flow] = type === "affects" ? target.split("/") : [];

  return {
    index,
    type,
    target,
    app,
    route: route ? { method: route[1] ?? "", path: route[2] ?? "" } : null,
    affects: type === "affects" ? { feature, flow: flow ?? null } : null,
    note: null,
    at: at(),
  };
}

export type FlowInput = {
  id: string;
  status?: WrittenFlow["status"]["value"];
  since?: string;
  steps?: WrittenStep[];
  criteria?: { id: string; app?: string | null; text?: string }[];
};

export function flow(feature: string, input: FlowInput): WrittenFlow {
  const file = `grimoire/features/${feature}/flows/${input.id}.md`;

  return {
    file,
    feature,
    id: located(input.id, file),
    ref: `${feature}/${input.id}`,
    since: located(input.since ?? "1.0", file),
    status: located(input.status ?? "shipped", file),
    who: located("customer", file),
    origin: null,
    heading: located(input.id, file),
    summary: null,
    story: [],
    steps: input.steps ?? [],
    differs: [],
    cases: [],
    notHandled: [],
    unknowns: [],
    criteria: (input.criteria ?? []).map((criterion) => ({
      id: criterion.id,
      number: Number(criterion.id.slice(3)),
      app: criterion.app ?? null,
      text: criterion.text ?? `${criterion.id} text`,
      at: at(file),
    })),
  };
}

export type FeatureInput = {
  id: string;
  folders?: string[];
  apps?: string[];
  status?: WrittenFlow["status"]["value"];
  version?: string;
  readme?: boolean;
  flows?: FlowInput[];
  changelog?: {
    version: string;
    word?: WrittenChangelogEntry["word"];
    release?: string | null;
    date?: string | null;
  }[];
};

export function feature(input: FeatureInput): WrittenFeature {
  const dir = `grimoire/features/${input.id}`;
  const readmeFile = `${dir}/README.md`;
  const entries: WrittenChangelogEntry[] = (input.changelog ?? []).map((entry) => ({
    feature: input.id,
    version: located(entry.version),
    word: entry.word ?? "added",
    flow: null,
    criteria: [],
    text: "a change",
    release: entry.release ?? null,
    date: entry.date ?? null,
    at: at(`${dir}/CHANGELOG.md`),
  }));

  return {
    id: input.id,
    dir,
    readme:
      input.readme === false
        ? null
        : {
            file: readmeFile,
            id: located(input.id, readmeFile),
            title: located(`The ${input.id} feature`, readmeFile),
            status: located(input.status ?? "shipped", readmeFile),
            version: located(input.version ?? "1.0", readmeFile),
            updated: located("2026-11-01", readmeFile),
            apps: (input.apps ?? []).map((app) => located(app, readmeFile)),
            folders: (input.folders ?? []).map((folder) => located(folder, readmeFile)),
            origin: null,
            heading: located(`The ${input.id} feature`, readmeFile),
            summary: null,
            audience: [],
            why: null,
            flows: [],
            relations: [],
          },
    changelog: input.changelog ? { file: `${dir}/CHANGELOG.md`, sections: [], entries } : null,
    flows: (input.flows ?? []).map((item) => flow(input.id, item)),
    versions: [],
  };
}

export function row(block: string, flowRef: string | null): WrittenBlockRow {
  return {
    block,
    flow: flowRef,
    who: { everyone: true, conditions: [] },
    changesWith: [],
    at: at(),
  };
}

export function page(
  app: string,
  id: string,
  route: string,
  blocks: WrittenBlockRow[],
  type: "page" | "screen" = "page",
): WrittenPage {
  const file = `grimoire/apps/${app}/${type}s/${id}/README.md`;

  return {
    file,
    app,
    type,
    id,
    route: located(route, file),
    screen: null,
    layout: null,
    origin: null,
    heading: null,
    purpose: null,
    screenshots: [],
    blocks,
    alsoReachedFrom: [],
    blockFiles: [],
  };
}

export function app(
  id: string,
  type: "site" | "mobile",
  root: string,
  parts: Partial<Pick<WrittenApp, "layouts" | "pages" | "screens">> = {},
): WrittenApp {
  const file = `grimoire/apps/${id}/README.md`;

  return {
    dir: `grimoire/apps/${id}`,
    file,
    id: located(id, file),
    type: located(type, file),
    root: located(root, file),
    origin: null,
    heading: null,
    conditions: [],
    layouts: parts.layouts ?? [],
    pages: parts.pages ?? [],
    screens: parts.screens ?? [],
  };
}

export function task(
  id: string,
  folder: "open" | "done",
  status: WrittenTask["status"]["value"],
  extra: {
    decisionNeeded?: string;
    shipped?: { feature: string; version: string };
    feature?: string;
  } = {},
): WrittenTask {
  const file =
    folder === "open" ? `grimoire/tasks/open/${id}-x.md` : `grimoire/tasks/done/2026-11/${id}-x.md`;

  return {
    file,
    folder,
    month: folder === "done" ? "2026-11" : null,
    id: located(id, file),
    type: located("bug", file),
    feature: extra.feature ? located(extra.feature, file) : null,
    flow: null,
    apps: [],
    status: located(status, file),
    shipped: extra.shipped ? located(extra.shipped, file) : null,
    heading: located(`Task ${id}`, file),
    fields: [],
    decisionNeeded: extra.decisionNeeded ?? null,
  };
}

export function written(
  parts: Partial<Pick<WrittenGrimoire, "features" | "apps" | "tasks">> = {},
): WrittenGrimoire {
  return {
    root: "/project",
    exists: true,
    features: parts.features ?? [],
    apps: parts.apps ?? [],
    tasks: parts.tasks ?? [],
    releases: [],
    hash: "written-hash",
  };
}
