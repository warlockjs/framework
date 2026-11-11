import type { SkillCatalogEntry, SkillRecord } from "../contracts/skill-record.type";
import type { SkillsStoreContract } from "../contracts/skills-store.contract";
import { candidateContentHash } from "./candidate-content";

/**
 * In-memory {@link SkillsStoreContract} that ships with the package.
 *
 * Backs tests and small/ephemeral skill libraries with zero external
 * dependencies. Holds the **latest** record per skill name; `saveCandidate`
 * writes an INERT `type: "candidate"` kept apart from the live records
 * (never injectable until promoted, never replacing a live skill), and
 * `promote` copies it to the live record as `type: "promoted"` with a
 * monotonic `version + 1`.
 *
 * Construct via `new MockSkillsStore([...records])` — it is a concrete
 * test/utility store, not a factory-fronted runtime primitive, so `new`
 * is the public surface here.
 *
 * @example
 * const store = new MockSkillsStore([
 *   { name: "scaffold", description: "Scaffold a form", version: 1, body: "...", type: "authored" },
 * ]);
 * const lib = skills({ name: "build", sources: [{ type: "store", store }] });
 */
export class MockSkillsStore implements SkillsStoreContract {
  /** Latest live record per skill name. */
  private readonly records = new Map<string, SkillRecord>();

  /** Saved candidates, keyed by `name` + content hash. */
  private readonly candidates = new Map<string, SkillRecord>();

  /** Content hash of the most recent candidate saved under each name. */
  private readonly latestCandidate = new Map<string, string>();

  public constructor(seed: SkillRecord[] = []) {
    for (const record of seed) {
      if (record.type === "candidate") {
        const hash = candidateContentHash(record);

        this.candidates.set(candidateKey(record.name, hash), { ...record });
        this.latestCandidate.set(record.name, hash);

        continue;
      }

      this.records.set(record.name, { ...record });
    }
  }

  /**
   * List the cheap catalog metadata for every NON-candidate skill,
   * optionally filtered to those whose `tags` intersect `scope.tags`.
   * Candidates are filtered out — they can never be catalogued or injected.
   */
  public async list(scope?: { tags?: string[] }): Promise<SkillCatalogEntry[]> {
    const wanted = scope?.tags;

    return [...this.records.values()]
      .filter((record) => record.type !== "candidate")
      .filter((record) => intersects(record.tags, wanted))
      .map(toCatalogEntry);
  }

  /**
   * Load the full record for `name`. When `version` is given, returns the
   * record only if its version matches (pin); otherwise the latest. A
   * `candidate` is never returned here — it is inert until promoted.
   */
  public async load(name: string, version?: number): Promise<SkillRecord | undefined> {
    const record = this.records.get(name);

    if (!record || record.type === "candidate") {
      return undefined;
    }

    if (version !== undefined && record.version !== version) {
      return undefined;
    }

    return { ...record };
  }

  /**
   * Write an INERT candidate (`type: "candidate"`, `version: 0`). A
   * candidate is filtered out of `list()` / `load()` — it can never be
   * injected until a `review` gate promotes it — and a live skill of the
   * same name stays as it is.
   */
  public async saveCandidate(record: Omit<SkillRecord, "version" | "type">): Promise<SkillRecord> {
    const candidate: SkillRecord = {
      ...record,
      version: 0,
      type: "candidate",
    };
    const hash = candidateContentHash(candidate);

    this.candidates.set(candidateKey(candidate.name, hash), candidate);
    this.latestCandidate.set(candidate.name, hash);

    return { ...candidate };
  }

  /**
   * Promote a candidate for `name` to a new monotonic version
   * (`type: "promoted"`, `version + 1`). With `candidate` (the reviewed
   * content), only the stored candidate with that exact content is
   * promoted; without it, the latest candidate saved under the name, else
   * the live record itself. Throws when there is nothing to promote or the
   * stored candidate no longer matches the reviewed content.
   */
  public async promote(
    name: string,
    candidate?: Pick<SkillRecord, "description" | "body" | "tags">,
  ): Promise<SkillRecord> {
    const live = this.records.get(name);
    let source: SkillRecord | undefined;
    let hash: string | undefined;

    if (candidate) {
      hash = candidateContentHash({ name, ...candidate });
      source = this.candidates.get(candidateKey(name, hash));

      if (!source && live && candidateContentHash(live) === hash) {
        source = live;
        hash = undefined;
      }

      if (!source) {
        throw new Error(
          `MockSkillsStore.promote: no stored candidate "${name}" matches the reviewed content — it was replaced or removed after review`,
        );
      }
    } else {
      hash = this.latestCandidate.get(name);
      source = hash === undefined ? undefined : this.candidates.get(candidateKey(name, hash));

      if (!source) {
        source = live;
        hash = undefined;
      }
    }

    if (!source) {
      throw new Error(`MockSkillsStore.promote: no skill named "${name}" to promote`);
    }

    const promoted: SkillRecord = {
      ...source,
      version: Math.max(live?.version ?? 0, source.version) + 1,
      type: "promoted",
    };

    this.records.set(name, promoted);

    if (hash !== undefined) {
      this.candidates.delete(candidateKey(name, hash));

      if (this.latestCandidate.get(name) === hash) {
        this.latestCandidate.delete(name);
      }
    }

    return { ...promoted };
  }
}

/** Map key of a stored candidate. */
function candidateKey(name: string, hash: string): string {
  return `${name}\u0000${hash}`;
}

/** Project a full record down to its catalog entry (body omitted). */
function toCatalogEntry(record: SkillRecord): SkillCatalogEntry {
  return {
    name: record.name,
    description: record.description,
    version: record.version,
    tags: record.tags,
    type: record.type,
  };
}

/**
 * True when no filter tags are requested, or when the record carries at
 * least one of the requested tags. A tagless record matches only the
 * unfiltered case.
 */
function intersects(recordTags: string[] | undefined, wanted: string[] | undefined): boolean {
  if (!wanted || wanted.length === 0) {
    return true;
  }

  if (!recordTags || recordTags.length === 0) {
    return false;
  }

  return recordTags.some((tag) => wanted.includes(tag));
}
