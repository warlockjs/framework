/**
 * Walks `<root>/grimoire`, reads each written file once, and hands it to the
 * parser of its kind. Paths are built as project-relative POSIX strings from
 * the folder names, so they read the same on every platform.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { GrimoireFinding } from "../contracts/findings";
import type { Located } from "../contracts/location";
import type {
  WrittenApp,
  WrittenBlockFile,
  WrittenFeature,
  WrittenGrimoire,
  WrittenLayout,
  WrittenPage,
  WrittenRelease,
  WrittenTask,
} from "../contracts/written";
import { GRIMOIRE_DIR } from "../paths";
import { parseAppReadme, parseBlockFile, parseLayout, parsePage, type AppReadme } from "./apps";
import { parseChangelog, parseFeatureReadme, parseFlow, parseVersionBrief } from "./features";
import { lineAt } from "./markdown";
import { FindingSink } from "./sink";
import { parseRelease, parseTask, type TaskPlace } from "./tasks-releases";

/** What `parseGrimoire()` returns. */
export type ParseGrimoireResult = {
  written: WrittenGrimoire;
  /** Structure findings (`GR1xxx`), in file and line order. */
  findings: GrimoireFinding[];
};

type PageType = "page" | "screen";

/** One written file to read, and what it is. */
type Job =
  | { type: "feature-readme"; file: string; feature: string }
  | { type: "changelog"; file: string; feature: string }
  | { type: "flow"; file: string; feature: string; name: string }
  | { type: "version"; file: string; feature: string; major: number }
  | { type: "app-readme"; file: string; app: string; fallbackType: "site" | "mobile" }
  | { type: "layout"; file: string; app: string; id: string }
  | { type: "page"; file: string; app: string; pageType: PageType; id: string }
  | { type: "block"; file: string; app: string; pageType: PageType; page: string; id: string }
  | { type: "task"; file: string; place: TaskPlace }
  | { type: "release"; file: string; name: string };

type Listing = { files: string[]; dirs: string[] };

const TASK_FILE = /^(T-\d+)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const VERSION_BRIEF = /^v(\d+)\.md$/;
const decoder = new TextDecoder("utf-8", { fatal: true });

/** The walk over the folders: what to read, and the layout findings. */
class Walker {
  public readonly jobs: Job[] = [];
  /** Feature and app folders, in name order. */
  public readonly features: string[] = [];
  public readonly apps: { id: string; dir: string; hasReadme: boolean }[] = [];

  public constructor(
    private readonly root: string,
    private readonly sink: FindingSink,
  ) {}

  private absolute(file: string): string {
    return path.join(this.root, ...file.split("/"));
  }

  /** The visible files and folders of a folder, each list in name order. Dot files are skipped. */
  public async list(dir: string): Promise<Listing> {
    let entries: Dirent[];

    try {
      entries = await readdir(this.absolute(dir), { withFileTypes: true });
    } catch {
      return { files: [], dirs: [] };
    }

    const files: string[] = [];
    const dirs: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        const target = await stat(this.absolute(`${dir}/${entry.name}`)).catch(() => null);
        isDirectory = target?.isDirectory() ?? false;
        isFile = target?.isFile() ?? false;
      }

      if (isDirectory) dirs.push(entry.name);
      else if (isFile) files.push(entry.name);
    }

    const byName = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

    return { files: files.sort(byName), dirs: dirs.sort(byName) };
  }

  /** GR1020 for a file the layout has no place for. */
  public unknown(file: string, sink: FindingSink = this.sink): void {
    sink.report("GR1020", `The file ${file} is not part of the grimoire layout.`, lineAt(file, 1));
  }

  /** GR1020 for every file under a folder the layout has no place for (a linked folder loop stops at a depth of 16). */
  public async unknownFolder(dir: string, sink: FindingSink = this.sink, depth = 0): Promise<void> {
    if (depth > 16) return;

    const listing = await this.list(dir);

    for (const name of listing.files) this.unknown(`${dir}/${name}`, sink);
    for (const name of listing.dirs) await this.unknownFolder(`${dir}/${name}`, sink, depth + 1);
  }

  public async walk(): Promise<void> {
    const top = await this.list(GRIMOIRE_DIR);

    for (const name of top.files) this.unknown(`${GRIMOIRE_DIR}/${name}`);

    for (const name of top.dirs) {
      const dir = `${GRIMOIRE_DIR}/${name}`;

      if (name === "book") continue;
      else if (name === "features") await this.walkFeatures(dir);
      else if (name === "apps") await this.walkApps(dir);
      else if (name === "tasks") await this.walkTasks(dir);
      else if (name === "releases") await this.walkReleases(dir);
      else await this.unknownFolder(dir);
    }
  }

  private async walkFeatures(featuresDir: string): Promise<void> {
    const listing = await this.list(featuresDir);

    for (const name of listing.files) {
      if (name !== "index.json") this.unknown(`${featuresDir}/${name}`);
    }

    for (const feature of listing.dirs) {
      const dir = `${featuresDir}/${feature}`;
      const sink = this.sink.scope({ feature });
      const inside = await this.list(dir);

      this.features.push(feature);

      for (const name of inside.files) {
        const file = `${dir}/${name}`;

        if (name === "README.md") this.jobs.push({ type: "feature-readme", file, feature });
        else if (name === "CHANGELOG.md") this.jobs.push({ type: "changelog", file, feature });
        else if (!name.endsWith(".json")) this.unknown(file, sink);
      }

      if (!inside.files.includes("README.md")) {
        sink.report("GR1021", `The feature folder ${dir} has no README.md.`, lineAt(`${dir}/README.md`, 1));
      }

      for (const sub of inside.dirs) {
        const subDir = `${dir}/${sub}`;

        if (sub === "flows") {
          const flows = await this.list(subDir);

          for (const name of flows.files) {
            const file = `${subDir}/${name}`;

            if (name.endsWith(".md")) this.jobs.push({ type: "flow", file, feature, name: name.slice(0, -3) });
            else if (!name.endsWith(".bookmap.json")) this.unknown(file, sink);
          }

          for (const name of flows.dirs) await this.unknownFolder(`${subDir}/${name}`, sink);
        } else if (sub === "versions") {
          const versions = await this.list(subDir);

          for (const name of versions.files) {
            const match = VERSION_BRIEF.exec(name);
            const file = `${subDir}/${name}`;

            if (match) this.jobs.push({ type: "version", file, feature, major: Number(match[1]) });
            else this.unknown(file, sink);
          }

          for (const name of versions.dirs) await this.unknownFolder(`${subDir}/${name}`, sink);
        } else {
          await this.unknownFolder(subDir, sink);
        }
      }
    }
  }

  private async walkApps(appsDir: string): Promise<void> {
    const listing = await this.list(appsDir);

    for (const name of listing.files) this.unknown(`${appsDir}/${name}`);

    for (const app of listing.dirs) {
      const dir = `${appsDir}/${app}`;
      const sink = this.sink.scope({ app });
      const inside = await this.list(dir);
      const hasReadme = inside.files.includes("README.md");

      this.apps.push({ id: app, dir, hasReadme });

      for (const name of inside.files) {
        if (name === "README.md") {
          this.jobs.push({
            type: "app-readme",
            file: `${dir}/${name}`,
            app,
            fallbackType: inside.dirs.includes("screens") ? "mobile" : "site",
          });
        } else {
          this.unknown(`${dir}/${name}`, sink);
        }
      }

      if (!hasReadme) {
        sink.report("GR1021", `The app folder ${dir} has no README.md.`, lineAt(`${dir}/README.md`, 1));
      }

      for (const sub of inside.dirs) {
        const subDir = `${dir}/${sub}`;

        if (sub === "layouts") {
          const layouts = await this.list(subDir);

          for (const name of layouts.files) {
            const file = `${subDir}/${name}`;

            if (name.endsWith(".md")) this.jobs.push({ type: "layout", file, app, id: name.slice(0, -3) });
            else this.unknown(file, sink);
          }

          for (const name of layouts.dirs) await this.unknownFolder(`${subDir}/${name}`, sink);
        } else if (sub === "pages" || sub === "screens") {
          await this.walkPages(subDir, app, sub === "pages" ? "page" : "screen", sink);
        } else {
          await this.unknownFolder(subDir, sink);
        }
      }
    }
  }

  private async walkPages(pagesDir: string, app: string, pageType: PageType, sink: FindingSink): Promise<void> {
    const listing = await this.list(pagesDir);

    for (const name of listing.files) this.unknown(`${pagesDir}/${name}`, sink);

    for (const page of listing.dirs) {
      const dir = `${pagesDir}/${page}`;
      const inside = await this.list(dir);

      for (const name of inside.files) {
        if (name === "README.md") this.jobs.push({ type: "page", file: `${dir}/${name}`, app, pageType, id: page });
        else this.unknown(`${dir}/${name}`, sink);
      }

      if (!inside.files.includes("README.md")) {
        sink.report("GR1021", `The ${pageType} folder ${dir} has no README.md.`, lineAt(`${dir}/README.md`, 1));
      }

      for (const sub of inside.dirs) {
        const subDir = `${dir}/${sub}`;

        if (sub !== "blocks") {
          await this.unknownFolder(subDir, sink);
          continue;
        }

        const blocks = await this.list(subDir);

        for (const name of blocks.files) {
          const file = `${subDir}/${name}`;

          if (name.endsWith(".md")) this.jobs.push({ type: "block", file, app, pageType, page, id: name.slice(0, -3) });
          else this.unknown(file, sink);
        }

        for (const name of blocks.dirs) await this.unknownFolder(`${subDir}/${name}`, sink);
      }
    }
  }

  /** GR1023 for a task file outside `open/` and `done/<yyyy-mm>/`; other files get GR1020. */
  private async misplacedTasks(dir: string, depth = 0): Promise<void> {
    if (depth > 16) return;

    const listing = await this.list(dir);

    for (const name of listing.files) this.misplacedTask(`${dir}/${name}`);
    for (const name of listing.dirs) await this.misplacedTasks(`${dir}/${name}`, depth + 1);
  }

  private misplacedTask(file: string): void {
    if (!file.endsWith(".md")) {
      this.unknown(file);
      return;
    }

    this.sink.report(
      "GR1023",
      `The task file ${file} is not in tasks/open/ or tasks/done/<yyyy-mm>/; it is not read.`,
      lineAt(file, 1),
    );
  }

  private taskFiles(dir: string, names: readonly string[], folder: "open" | "done", month: string | null): void {
    for (const name of names) {
      const file = `${dir}/${name}`;

      if (!name.endsWith(".md")) {
        this.unknown(file);
        continue;
      }

      const match = TASK_FILE.exec(name);

      if (!match) {
        this.sink.report("GR1023", `The task file name ${name} is not T-<n>-<slug>.md.`, lineAt(file, 1));
      }

      this.jobs.push({ type: "task", file, place: { folder, month, nameId: match?.[1] ?? null } });
    }
  }

  private async walkTasks(tasksDir: string): Promise<void> {
    const listing = await this.list(tasksDir);

    for (const name of listing.files) {
      if (name !== "index.json") this.misplacedTask(`${tasksDir}/${name}`);
    }

    for (const sub of listing.dirs) {
      const dir = `${tasksDir}/${sub}`;
      const inside = await this.list(dir);

      if (sub === "open") {
        this.taskFiles(dir, inside.files, "open", null);
        for (const name of inside.dirs) await this.misplacedTasks(`${dir}/${name}`);
      } else if (sub === "done") {
        for (const name of inside.files) this.misplacedTask(`${dir}/${name}`);

        for (const month of inside.dirs) {
          const monthDir = `${dir}/${month}`;

          if (!MONTH.test(month)) {
            await this.misplacedTasks(monthDir);
            continue;
          }

          const files = await this.list(monthDir);

          this.taskFiles(monthDir, files.files, "done", month);
          for (const name of files.dirs) await this.misplacedTasks(`${monthDir}/${name}`);
        }
      } else {
        await this.misplacedTasks(dir);
      }
    }
  }

  private async walkReleases(releasesDir: string): Promise<void> {
    const listing = await this.list(releasesDir);

    for (const name of listing.files) {
      const file = `${releasesDir}/${name}`;

      if (name.endsWith(".md")) this.jobs.push({ type: "release", file, name: name.slice(0, -3) });
      else this.unknown(file);
    }

    for (const name of listing.dirs) await this.unknownFolder(`${releasesDir}/${name}`);
  }
}

/** Read one file as UTF-8; `null` (with GR1025) when it cannot be read or is not UTF-8. */
async function readWritten(
  root: string,
  file: string,
  sink: FindingSink,
): Promise<{ bytes: Uint8Array; text: string } | null> {
  try {
    const bytes = await readFile(path.join(root, ...file.split("/")));

    try {
      return { bytes, text: decoder.decode(bytes) };
    } catch {
      sink.report("GR1025", `The file ${file} is not UTF-8 text.`, lineAt(file, 1));

      return null;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    sink.report("GR1025", `The file ${file} cannot be read: ${reason}`, lineAt(file, 1));

    return null;
  }
}

function sinkFor(job: Job, sink: FindingSink): FindingSink {
  switch (job.type) {
    case "feature-readme":
    case "changelog":
    case "version":
      return sink.scope({ feature: job.feature });
    case "flow":
      return sink.scope({ feature: job.feature, flow: `${job.feature}/${job.name}` });
    case "app-readme":
    case "layout":
    case "page":
    case "block":
      return sink.scope({ app: job.app });
    case "task":
      return sink.scope({ task: job.place.nameId });
    case "release":
      return sink;
  }
}

function taskNumber(task: WrittenTask): number {
  const match = /^T-(\d+)$/.exec(task.id.value) ?? /(?:^|\/)T-(\d+)-[^/]*$/.exec(task.file);

  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Parse every written file under `<root>/grimoire`. A project without a
 * `grimoire/` folder gives `written.exists === false` and no findings. Bad
 * input never throws: each problem is a `GR1xxx` finding at its line, and
 * the rest of the file is still read.
 *
 * @param root Absolute project root.
 */
export async function parseGrimoire(root: string): Promise<ParseGrimoireResult> {
  const absoluteRoot = path.resolve(root);
  const sink = new FindingSink();
  const hash = createHash("sha256");
  const written: WrittenGrimoire = {
    root: absoluteRoot,
    exists: false,
    features: [],
    apps: [],
    tasks: [],
    releases: [],
    hash: "",
  };

  const grimoireStat = await stat(path.join(absoluteRoot, GRIMOIRE_DIR)).catch(() => null);

  if (!grimoireStat?.isDirectory()) {
    written.hash = hash.digest("hex");

    return { written, findings: [] };
  }

  written.exists = true;

  const walker = new Walker(absoluteRoot, sink);
  await walker.walk();

  const texts = await Promise.all(walker.jobs.map((job) => readWritten(absoluteRoot, job.file, sinkFor(job, sink))));
  const hashed = walker.jobs
    .map((job, index) => ({ file: job.file, read: texts[index] }))
    .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));

  for (const { file, read } of hashed) {
    if (!read) continue;

    hash.update(file);
    hash.update("\0");
    hash.update(read.bytes);
    hash.update("\0");
  }

  written.hash = hash.digest("hex");

  const features = new Map<string, WrittenFeature>(
    walker.features.map((id) => [
      id,
      { id, dir: `${GRIMOIRE_DIR}/features/${id}`, readme: null, changelog: null, flows: [], versions: [] },
    ]),
  );
  const appReadmes = new Map<string, { file: string; readme: AppReadme }>();
  const layouts = new Map<string, WrittenLayout[]>();
  const pages = new Map<string, WrittenPage[]>();
  const blockFiles = new Map<string, WrittenBlockFile[]>();
  const tasks: WrittenTask[] = [];
  const releases: WrittenRelease[] = [];
  const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
    const list = map.get(key);

    if (list) list.push(value);
    else map.set(key, [value]);
  };

  walker.jobs.forEach((job, index) => {
    const read = texts[index];

    if (!read) return;

    const fileSink = sinkFor(job, sink);
    const text = read.text;

    switch (job.type) {
      case "feature-readme": {
        const feature = features.get(job.feature);
        if (feature) feature.readme = parseFeatureReadme(job.file, text, job.feature, fileSink);
        return;
      }
      case "changelog": {
        const feature = features.get(job.feature);
        if (feature) feature.changelog = parseChangelog(job.file, text, job.feature, fileSink);
        return;
      }
      case "flow":
        features.get(job.feature)?.flows.push(parseFlow(job.file, text, job.feature, job.name, fileSink));
        return;
      case "version":
        features.get(job.feature)?.versions.push(parseVersionBrief(job.file, text, job.feature, job.major, fileSink));
        return;
      case "app-readme":
        appReadmes.set(job.app, {
          file: job.file,
          readme: parseAppReadme(job.file, text, job.app, job.fallbackType, fileSink),
        });
        return;
      case "layout":
        push(layouts, job.app, parseLayout(job.file, text, job.app, job.id, fileSink));
        return;
      case "page":
        push(pages, `${job.app}/${job.pageType}/${job.id}`, parsePage(job.file, text, job.app, job.pageType, job.id, fileSink));
        return;
      case "block":
        push(
          blockFiles,
          `${job.app}/${job.pageType}/${job.page}`,
          parseBlockFile(job.file, text, job.app, job.page, job.id, fileSink),
        );
        return;
      case "task":
        tasks.push(parseTask(job.file, text, job.place, fileSink));
        return;
      case "release":
        releases.push(parseRelease(job.file, text, job.name, fileSink));
        return;
    }
  });

  for (const feature of features.values()) {
    feature.versions.sort((left, right) => left.major - right.major);
    linkFlows(feature, sink.scope({ feature: feature.id }));
    written.features.push(feature);
  }

  for (const app of walker.apps) {
    const found = appReadmes.get(app.id);
    const missing = { value: app.id, at: lineAt(`${app.dir}/README.md`, 1) };
    const appPages = (type: PageType): WrittenPage[] =>
      [...pages.entries()]
        .filter(([key]) => key.startsWith(`${app.id}/${type}/`))
        .map(([key, list]) => list.map((page) => ({ ...page, blockFiles: blockFiles.get(key) ?? [] })))
        .flat();
    const pageList = appPages("page");
    const screenList = appPages("screen");

    written.apps.push({
      dir: app.dir,
      file: found?.file ?? null,
      id: found?.readme.id ?? missing,
      type: found?.readme.type ?? { value: screenList.length > 0 ? "mobile" : "site", at: missing.at },
      root: found?.readme.root ?? { value: "", at: missing.at },
      heading: found?.readme.heading ?? null,
      conditions: found?.readme.conditions ?? [],
      layouts: layouts.get(app.id) ?? [],
      pages: pageList,
      screens: screenList,
    } satisfies WrittenApp);
  }

  duplicates(
    written.apps.filter((app) => app.file !== null).map((app) => ({ id: app.id, subject: { app: app.id.value } })),
    "app",
    sink,
  );

  tasks.sort((left, right) => taskNumber(left) - taskNumber(right) || (left.file < right.file ? -1 : 1));
  duplicates(
    tasks.filter((task) => task.id.value !== "").map((task) => ({ id: task.id, subject: { task: task.id.value } })),
    "task",
    sink,
  );
  written.tasks = tasks;
  written.releases = releases;

  return { written, findings: sink.sorted() };
}

/** GR1026 for a README flow with no file; GR1027 for a flow file the README does not list. */
function linkFlows(feature: WrittenFeature, sink: FindingSink): void {
  if (feature.readme === null) return;

  const files = new Set(feature.flows.map((flow) => flow.ref.slice(feature.id.length + 1)));
  const listed = new Set(feature.readme.flows.map((line) => line.name));

  for (const line of feature.readme.flows) {
    if (!files.has(line.name)) {
      sink
        .scope({ flow: `${feature.id}/${line.name}` })
        .report("GR1026", `The README lists the flow "${line.name}", which has no file flows/${line.name}.md.`, line.at);
    }
  }

  for (const flow of feature.flows) {
    const name = flow.ref.slice(feature.id.length + 1);

    if (!listed.has(name)) {
      sink
        .scope({ flow: flow.ref })
        .report("GR1027", `The flow "${name}" is not listed under "## Flows" in the feature README.`, lineAt(flow.file, 1));
    }
  }
}

/** GR1022 for each id already used by an earlier file. */
function duplicates(
  items: { id: Located<string>; subject: { app?: string; task?: string } }[],
  what: string,
  sink: FindingSink,
): void {
  const seen = new Map<string, string>();

  for (const item of items) {
    const first = seen.get(item.id.value);

    if (first !== undefined) {
      sink.scope(item.subject).report("GR1022", `The ${what} id ${item.id.value} is also used by ${first}.`, item.id.at);
      continue;
    }

    seen.set(item.id.value, item.id.at.file);
  }
}
