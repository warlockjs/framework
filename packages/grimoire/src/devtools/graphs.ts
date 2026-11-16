/**
 * The small graphs of the tab: a file's neighbours, a feature and its
 * neighbours, a page and its blocks, and module coupling. Each answer has at
 * most `GRAPH_LIMIT` nodes. Node ids carry their kind (`file:`, `feature:`,
 * `flow:`, `page:`, `block:`, `layout:`, `module:`, `app:`) so the view can link them.
 */
import type { GrimoireSnapshot } from "../contracts/snapshot";

/** The most nodes a graph answer holds. */
export const GRAPH_LIMIT = 60;

export type GraphNode = { id: string; label: string; type: string };
export type GraphEdge = { from: string; to: string; type: string; weight?: number };
export type GrimoireGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Collects nodes and edges, dropping what goes over the limit. */
class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();

  public node(id: string, label: string, type: string): boolean {
    if (this.nodes.has(id)) return true;

    if (this.nodes.size >= GRAPH_LIMIT) return false;

    this.nodes.set(id, { id, label, type });

    return true;
  }

  public edge(from: string, to: string, type: string, weight?: number): void {
    if (!this.nodes.has(from) || !this.nodes.has(to) || from === to) return;

    const key = `${from}\n${to}\n${type}`;

    if (this.edges.has(key)) return;

    this.edges.set(key, weight === undefined ? { from, to, type } : { from, to, type, weight });
  }

  public build(): GrimoireGraph {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
}

/** The short name shown for a project path. */
function fileLabel(file: string): string {
  const parts = file.split("/");

  return parts.slice(-2).join("/");
}

/** A file, the files it imports and the files that import it. `null` when the file is not in the book. */
export function fileGraph(snapshot: GrimoireSnapshot, file: string): GrimoireGraph | null {
  const entry = snapshot.book.facts.files.find((candidate) => candidate.file === file);

  if (entry === undefined) return null;

  const graph = new GraphBuilder();
  const center = `file:${file}`;

  graph.node(center, fileLabel(file), "center");

  for (const target of entry.imports) {
    if (target.file === null) continue;

    if (graph.node(`file:${target.file}`, fileLabel(target.file), "file")) {
      graph.edge(center, `file:${target.file}`, "imports");
    }
  }

  for (const importer of entry.importedBy) {
    if (graph.node(`file:${importer}`, fileLabel(importer), "file")) {
      graph.edge(`file:${importer}`, center, "imports");
    }
  }

  return graph.build();
}

/** A feature, its flows, the apps showing them and the features it borrows from, lends to or affects. `null` for an unknown feature. */
export function featureGraph(snapshot: GrimoireSnapshot, feature: string): GrimoireGraph | null {
  const written = snapshot.written.features.find((candidate) => candidate.id === feature);

  if (written === undefined) return null;

  const graph = new GraphBuilder();
  const center = `feature:${feature}`;

  graph.node(center, feature, "center");

  for (const flow of written.flows) {
    const id = `flow:${flow.ref}`;

    if (graph.node(id, flow.id.value, "flow")) graph.edge(center, id, "has");

    for (const step of flow.steps) {
      if (step.affects === null) continue;

      const other = `feature:${step.affects.feature}`;

      if (graph.node(other, step.affects.feature, "feature")) graph.edge(id, other, "affects");
    }
  }

  const bookmap = snapshot.collected.features[feature];

  for (const borrowed of bookmap?.borrowed ?? []) {
    if (borrowed.owner === null) continue;

    const other = `feature:${borrowed.owner}`;

    if (graph.node(other, borrowed.owner, "feature")) graph.edge(center, other, "borrows");
  }

  for (const [other, ownership] of Object.entries(snapshot.ownership.features)) {
    if (other !== feature && ownership.borrowed.some((file) => snapshot.ownership.files[file]?.owner === feature)) {
      if (graph.node(`feature:${other}`, other, "feature")) graph.edge(`feature:${other}`, center, "borrows");
    }
  }

  for (const [flowRef, flowMap] of Object.entries(snapshot.collected.flows)) {
    if (flowMap.feature !== feature) continue;

    for (const shown of flowMap.shownBy) {
      const id = `app:${shown.app}`;

      if (graph.node(id, shown.app, "app")) graph.edge(id, `flow:${flowRef}`, "shows");
    }
  }

  return graph.build();
}

/** A page (or screen), its layout, its blocks and the flows the blocks show. `null` for an unknown page. */
export function pageGraph(snapshot: GrimoireSnapshot, app: string, pageKey: string): GrimoireGraph | null {
  const written = snapshot.written.apps.find((candidate) => candidate.id.value === app);
  const page = [...(written?.pages ?? []), ...(written?.screens ?? [])].find(
    (candidate) => candidate.id === pageKey || candidate.route?.value === pageKey || candidate.screen?.value === pageKey,
  );

  if (written === undefined || page === undefined) return null;

  const graph = new GraphBuilder();
  const center = `page:${app}/${page.id}`;

  graph.node(center, page.heading?.value ?? page.id, "center");

  const layoutId = page.layout?.value ?? null;
  const layout = layoutId === null ? undefined : written.layouts.find((candidate) => candidate.id === layoutId);

  if (layout !== undefined && graph.node(`layout:${app}/${layout.id}`, layout.id, "layout")) {
    graph.edge(`layout:${app}/${layout.id}`, center, "wraps");
  }

  const blocks = [...(layout?.blocks ?? []), ...page.blocks];

  for (const block of blocks) {
    const id = `block:${app}/${page.id}/${block.block}`;

    if (!graph.node(id, block.block, "block")) continue;

    graph.edge(center, id, "shows");

    if (block.flow !== null && graph.node(`flow:${block.flow}`, block.flow, "flow")) {
      graph.edge(id, `flow:${block.flow}`, "shows");
    }
  }

  return graph.build();
}

/** Modules as nodes, weighted import edges between them; the most connected modules when there are more than the limit. */
export function moduleGraph(snapshot: GrimoireSnapshot): GrimoireGraph {
  const moduleOf = new Map<string, string>();
  const sizes = new Map<string, number>();

  for (const file of snapshot.book.facts.files) {
    moduleOf.set(file.file, file.module);
    sizes.set(file.module, (sizes.get(file.module) ?? 0) + 1);
  }

  const weights = new Map<string, number>();
  const degree = new Map<string, number>();

  for (const file of snapshot.book.facts.files) {
    for (const target of file.imports) {
      const to = target.file === null ? undefined : moduleOf.get(target.file);

      if (to === undefined || to === file.module) continue;

      const key = `${file.module}\n${to}`;

      weights.set(key, (weights.get(key) ?? 0) + 1);
      degree.set(file.module, (degree.get(file.module) ?? 0) + 1);
      degree.set(to, (degree.get(to) ?? 0) + 1);
    }
  }

  const modules = [...sizes.keys()]
    .sort((left, right) => (degree.get(right) ?? 0) - (degree.get(left) ?? 0) || left.localeCompare(right))
    .slice(0, GRAPH_LIMIT);
  const graph = new GraphBuilder();

  for (const module of modules) graph.node(`module:${module}`, `${module} (${sizes.get(module) ?? 0})`, "module");

  for (const [key, weight] of [...weights.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [from, to] = key.split("\n");

    if (from !== undefined && to !== undefined) graph.edge(`module:${from}`, `module:${to}`, "imports", weight);
  }

  return graph.build();
}
