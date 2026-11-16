/**
 * GR5001–GR5009: the written apps against the sites, pages, screens, flows
 * and conditions they mention.
 */
import { createFinding } from "../codes";
import type { BookFacts } from "../contracts/adapter";
import type { GrimoireFinding } from "../contracts/findings";
import type { SourceLocation } from "../contracts/location";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { WrittenApp, WrittenBlockRow, WrittenPage } from "../contracts/written";
import { toPosixPath } from "../paths";

type Subject = { feature: string | null; flow: string | null };

/** The feature and flow a block row points at, split from `<feature>/<flow>`. */
function flowSubject(flow: string | null): Subject {
  if (!flow) return { feature: null, flow: null };

  return { feature: flow.split("/")[0] ?? null, flow };
}

/** The flow all blocks of a page share, else their feature when they share one, else nothing. */
function pageSubject(page: WrittenPage): Subject {
  const refs = [...new Set(page.blocks.map((row) => row.flow).filter((ref) => ref !== null))];

  if (refs.length === 1) return flowSubject(refs[0] ?? null);

  const features = [...new Set(refs.map((ref) => ref.split("/")[0] ?? ""))];

  return { feature: features.length === 1 ? (features[0] ?? null) : null, flow: null };
}

/** A route as the router and the page graph compare it: `[id]` and `:id` are one parameter. */
function normalizeRoute(route: string): string {
  const withSlash = toPosixPath(route.trim())
    .replace(/\[\.\.\.(\w+)\]/g, ":$1*")
    .replace(/\[(\w+)\]/g, ":$1");
  const trimmed = withSlash.replace(/\/+$/, "");

  return trimmed === "" ? "/" : trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** The id of a block file for a table row: `New arrivals` → `new-arrivals`. */
function blockSlug(block: string): string {
  return block
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pagesOf(app: WrittenApp): WrittenPage[] {
  return [...app.pages, ...app.screens];
}

/**
 * GR5001–GR5009. Read-only. Pages and screens are compared with the adapter's
 * facts only when the app matched a site or mobile app (`GR5005` otherwise).
 */
export function checkApps(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];
  const facts = snapshot.book.facts;
  const flows = new Set<string>();

  for (const feature of snapshot.written.features) {
    for (const flow of feature.flows) flows.add(`${feature.id}/${flow.id.value}`);
  }

  for (const app of snapshot.written.apps) {
    const match = snapshot.apps[app.id.value] ?? null;
    const appId = app.id.value;
    const declared = new Set(app.conditions.map((line) => line.name));
    const layoutIds = new Set(app.layouts.map((layout) => layout.id));

    const checkRow = (row: WrittenBlockRow): void => {
      const subject = flowSubject(row.flow);

      if (row.flow !== null && !flows.has(row.flow)) {
        findings.push(
          createFinding({
            code: "GR5001",
            message: `block "${row.block}" points to flow "${row.flow}", which does not exist`,
            at: row.at,
            app: appId,
            ...subject,
          }),
        );
      }

      const used = [
        ...row.who.conditions,
        ...row.changesWith.flatMap((item) => (item.condition === null ? [] : [item.condition])),
      ];

      for (const condition of new Set(used)) {
        if (declared.has(condition)) continue;

        findings.push(
          createFinding({
            code: "GR5002",
            message: `condition "${condition}" is not declared in the README of app "${appId}"`,
            at: row.at,
            app: appId,
            ...subject,
          }),
        );
      }
    };

    for (const layout of app.layouts) layout.blocks.forEach(checkRow);

    for (const page of pagesOf(app)) {
      const subject = pageSubject(page);
      const label = `${page.type} "${page.id}"`;

      page.blocks.forEach(checkRow);

      for (const block of page.blockFiles) {
        if (block.flow !== null && !flows.has(block.flow.value)) {
          findings.push(
            createFinding({
              code: "GR5001",
              message: `block file "${block.id}" of ${label} points to flow "${block.flow.value}", which does not exist`,
              at: block.flow.at,
              app: appId,
              ...flowSubject(block.flow.value),
            }),
          );
        }

        if (!page.blocks.some((row) => blockSlug(row.block) === block.id)) {
          findings.push(
            createFinding({
              code: "GR5007",
              message: `block file "${block.id}" has no row in the Blocks table of ${label}`,
              at: { file: block.file, line: 1, column: null },
              app: appId,
              ...(block.flow ? flowSubject(block.flow.value) : subject),
            }),
          );
        }
      }

      if (page.layout !== null && !layoutIds.has(page.layout.value)) {
        findings.push(
          createFinding({
            code: "GR5004",
            message: `${label} names layout "${page.layout.value}", but ${app.dir}/layouts/${page.layout.value}.md does not exist`,
            at: page.layout.at,
            app: appId,
            ...subject,
          }),
        );
      }

      if (match) checkReached(page, label, subject, appId, facts, match, app.screens, findings);
    }

    // An app folder with no README is reported as GR1021 by the parser.
    if (app.file !== null && (!match || (!match.site && !match.mobile))) {
      findings.push(
        createFinding({
          code: "GR5005",
          message: `the root "${app.root.value}" of app "${appId}" matches no ${app.type.value === "site" ? "site" : "mobile app"} the code reports`,
          at: app.root.at,
          app: appId,
        }),
      );
      continue;
    }

    if (!match) continue;

    if (match.site) {
      const routes = new Set(
        facts.pages
          .filter((item) => item.site === match.site?.id)
          .map((item) => normalizeRoute(item.route)),
      );

      for (const page of app.pages) {
        if (!page.route || routes.has(normalizeRoute(page.route.value))) continue;

        findings.push(
          createFinding({
            code: "GR5003",
            message: `page "${page.id}" has route "${page.route.value}", which is not a page of site "${match.site.id}"`,
            at: page.route.at,
            app: appId,
            ...pageSubject(page),
          }),
        );
      }
    }

    if (match.mobile && match.mobile.routing === "files") {
      const routes = new Set(match.mobile.screens.map((screen) => normalizeRoute(screen.route)));

      for (const screen of app.screens) {
        const where: SourceLocation | null = screen.route?.at ?? screen.screen?.at ?? null;
        const route = screen.route?.value ?? null;

        if (route !== null && routes.has(normalizeRoute(route))) continue;

        findings.push(
          createFinding({
            code: "GR5006",
            message:
              route === null
                ? `screen "${screen.id}" has no route, and mobile app "${match.mobile.id}" uses file-based routing`
                : `screen "${screen.id}" has route "${route}", which is not a screen of mobile app "${match.mobile.id}"`,
            at: where ?? { file: screen.file, line: 1, column: null },
            app: appId,
            ...pageSubject(screen),
          }),
        );
      }
    }
  }

  checkUncovered(snapshot, findings);

  return findings;
}

/** GR5008: an `Also reached from` entry that names nothing the code has. */
function checkReached(
  page: WrittenPage,
  label: string,
  subject: Subject,
  appId: string,
  facts: BookFacts,
  match: NonNullable<GrimoireSnapshot["apps"][string]>,
  declaredScreens: readonly WrittenPage[],
  findings: GrimoireFinding[],
): void {
  for (const entry of page.alsoReachedFrom) {
    let found = true;

    if (entry.kind === "mail" || entry.kind === "notification") {
      found = facts.named.some((item) => item.type === entry.kind && item.name === entry.name);
    } else if (entry.kind === "page") {
      const site = match.site;
      const wanted = normalizeRoute(entry.name);

      found =
        site !== null &&
        facts.pages.some(
          (item) =>
            item.site === site.id &&
            (normalizeRoute(item.route) === wanted || item.name === entry.name),
        );
    } else if (entry.kind === "screen") {
      const wanted = normalizeRoute(entry.name);

      found =
        match.mobile?.screens.some((item) => normalizeRoute(item.route) === wanted) === true ||
        declaredScreens.some(
          (item) =>
            item.id === entry.name ||
            item.screen?.value === entry.name ||
            (item.route !== null && normalizeRoute(item.route.value) === wanted),
        );
    }

    if (found) continue;

    findings.push(
      createFinding({
        code: "GR5008",
        message: `${label} is reached from ${entry.kind} "${entry.name}", which does not exist`,
        at: entry.at,
        app: appId,
        ...subject,
      }),
    );
  }
}

/** GR5009: a site or mobile app the code reports that no written app describes. */
function checkUncovered(snapshot: GrimoireSnapshot, findings: GrimoireFinding[]): void {
  if (snapshot.written.apps.length === 0) return;

  const sites = new Set<string>();
  const mobiles = new Set<string>();

  for (const match of Object.values(snapshot.apps)) {
    if (match.site) sites.add(match.site.id);
    if (match.mobile) mobiles.add(match.mobile.id);
  }

  for (const site of snapshot.book.facts.sites) {
    if (sites.has(site.id)) continue;

    findings.push(
      createFinding({
        code: "GR5009",
        message: `site "${site.id}" (${site.root}) has no folder in grimoire/apps`,
      }),
    );
  }

  for (const mobile of snapshot.book.facts.mobile) {
    if (mobiles.has(mobile.id)) continue;

    findings.push(
      createFinding({
        code: "GR5009",
        message: `mobile app "${mobile.id}" (${mobile.root}) has no folder in grimoire/apps`,
      }),
    );
  }
}
