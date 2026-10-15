import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { publishAtomically } from "./atomic-publish";
import { atomicWriteFile } from "./atomic-write-file";
import { normalizeEntry } from "./normalize-entry";
import type {
  DuplicateReport,
  ResolvedSitemapEntry,
  RouteSummary,
  SitemapEntry,
  SitemapOptions,
} from "./types";
import { normalizeBaseUrl } from "./url";
import { buildSitemapXml } from "./xml";

/**
 * A bounded sitemap builder: it RETAINS every entry, which is what makes
 * `entries()` and a repeatable `toXML()` possible, and is exactly right up to
 * the sitemaps.org ceiling of 50,000 URLs / 50MB.
 *
 * Above that ceiling this is the wrong tool — the streaming writer retains
 * nothing and emits shards plus an index instead. The two modes are separate
 * on purpose: a class that promised not to retain entries and still offered
 * `entries()` would be lying about one of them.
 */
export class Sitemap {
  private readonly baseUrl: string;

  private readonly defaults: Pick<
    SitemapOptions,
    "changefreq" | "priority" | "lastmod" | "onImageLimitExceeded"
  >;

  private readonly warnedImageRoutes = new Set<string>();

  private readonly optionsImageReporter: SitemapOptions["onImageLimitExceeded"];

  /** Keyed by path: a duplicate `<loc>` makes the document invalid, so the later add wins. */
  private readonly entriesByPath = new Map<string, ResolvedSitemapEntry>();

  /** Insertion order per path, so `duplicates()` can name every colliding source. */
  private readonly routesByPath = new Map<string, (string | undefined)[]>();

  /** Declared patterns, including ones that never contributed a URL. */
  private readonly declaredRoutes = new Set<string>();

  public constructor(options: SitemapOptions) {
    this.baseUrl = normalizeBaseUrl(options?.baseUrl);
    this.optionsImageReporter = options.onImageLimitExceeded;
    this.defaults = {
      changefreq: options.changefreq,
      priority: options.priority,
      lastmod: options.lastmod,
      onImageLimitExceeded: (event) => this.reportImageLimit(event),
    };
  }

  private reportImageLimit(event: { readonly route?: string; readonly dropped: number }): void {
    const key = event.route ?? "unattributed";
    if (this.warnedImageRoutes.has(key)) return;

    this.warnedImageRoutes.add(key);
    if (this.optionsImageReporter) this.optionsImageReporter(event);
    else
      console.warn(
        `[warlock:sitemap] ${key} exceeded the 1,000-image limit; dropped ${event.dropped} image(s).`,
      );
  }

  public add(entry: SitemapEntry): this {
    const resolved = normalizeEntry(entry, this.defaults);

    this.entriesByPath.set(resolved.path, resolved);

    const seen = this.routesByPath.get(resolved.path);

    if (seen) {
      seen.push(resolved.route);
    } else {
      this.routesByPath.set(resolved.path, [resolved.route]);
    }

    if (resolved.route !== undefined) this.declaredRoutes.add(resolved.route);

    return this;
  }

  public addMany(entries: Iterable<SitemapEntry>): this {
    for (const entry of entries) this.add(entry);

    return this;
  }

  /**
   * Names a pattern the caller EXPECTS to contribute URLs, so that one which
   * contributes none shows up in `routes()` as a `count: 0` row instead of as
   * silence. A dynamic route whose supplier returned nothing is the failure
   * this package exists to make visible.
   */
  public declareRoute(route: string): this {
    this.declaredRoutes.add(route);

    return this;
  }

  public get size(): number {
    return this.entriesByPath.size;
  }

  public entries(): readonly ResolvedSitemapEntry[] {
    return [...this.entriesByPath.values()];
  }

  public routes(): readonly RouteSummary[] {
    const counts = new Map<string, number>();

    for (const route of this.declaredRoutes) counts.set(route, 0);

    for (const entry of this.entriesByPath.values()) {
      if (entry.route === undefined) continue;

      counts.set(entry.route, (counts.get(entry.route) ?? 0) + 1);
    }

    return [...counts].map(([route, count]) => ({ route, count }));
  }

  /**
   * Every path added more than once. The override is silent — it is not
   * hidden: a collision between static discovery and a dynamic supplier is a
   * real defect, and the CALLER decides whether it fails their build. This
   * package reports; it never prints and never throws over a duplicate.
   */
  public duplicates(): readonly DuplicateReport[] {
    const reports: DuplicateReport[] = [];

    for (const [path, routes] of this.routesByPath) {
      if (routes.length < 2) continue;

      reports.push({ path, count: routes.length, routes: [...routes] });
    }

    return reports;
  }

  /** Pure and repeatable: calling it twice returns the same string and mutates nothing. */
  public toXML(): string {
    return buildSitemapXml(this.entries(), this.baseUrl);
  }

  /**
   * Writes the document, creating parent directories so a clean checkout
   * works. The write is atomic: a failed or interrupted publish leaves
   * whatever was already at `filePath` untouched instead of truncating it.
   */
  public async saveTo(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await atomicWriteFile(filePath, this.toXML());
  }

  /**
   * Publishes the document as the whole content of `outDir`, exactly the way
   * `SitemapIndex.saveTo` publishes a set: swapped in atomically, and marked
   * as owned. So a site that later outgrows one file can publish an index
   * into the same directory, and a later single file removes stale shards.
   * Refuses a non-empty directory this package did not write
   * (`UnownedOutputDirectoryError`). Returns the published file's path.
   */
  public async publishTo(outDir: string, fileName = "sitemap.xml"): Promise<string> {
    const xml = this.toXML();

    await publishAtomically(outDir, async (tempDir) => {
      await writeFile(join(tempDir, fileName), xml, "utf8");

      return [fileName];
    });

    return join(outDir, fileName);
  }
}
