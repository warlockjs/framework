import type { CacheDriver } from "@warlock.js/cache";
import { resolveDefaultStore } from "../../config";
import type { MemoryContract } from "../../contracts/memory/memory.contract";
import type { ProceduralMemoryConfig } from "../../contracts/memory/memory-config.type";
import { memory } from "../../memory";
import type { SkillCatalogEntry, SkillRecord } from "../contracts/skill-record.type";
import type { SkillsStoreContract } from "../contracts/skills-store.contract";
import { candidateContentHash } from "./candidate-content";

/**
 * Metadata a procedural memory carries to round-trip a skill. `recall()`
 * surfaces `metadata` verbatim, so the skill's identity (name, version,
 * provenance, description, tags) rides here while the procedure body lives
 * in the memory's `text`.
 */
type ProceduralSkillMeta = {
  /** Marks the record as a skill (vs. a plain procedure) so `list` can scope. */
  skill: true;
  /** Skill name — the catalog key (also the procedural memory `id` once promoted). */
  name: string;
  /** Provenance flag round-tripped onto the SkillRecord. */
  type: "candidate" | "promoted";
  /** Catalog line. */
  description: string;
  /** Monotonic version — bumped on promote. */
  version: number;
  /** Optional scope tags. */
  tags?: string[];
};

/** A recalled skill entry — the procedure body plus its skill metadata. */
type ProceduralSkillEntry = { body: string; meta: ProceduralSkillMeta };

/**
 * Catalog index document: the metadata of every live (promoted) skill,
 * keyed by name. One `get` lists the library — no embedding call and no
 * similarity scan.
 */
type SkillIndex = {
  layout: 2;
  skills: Record<string, ProceduralSkillMeta>;
};

/** Pointer to the most recent candidate saved under a name. */
type CandidatePointer = { hash: string };

/** Size of the one-time similarity recall that reads skills stored by an earlier release. */
const RECALL_K = 1000;

/** Default key namespace — the procedural tier's own default. */
const DEFAULT_NAMESPACE = "ai.memory.procedural";

/**
 * {@link SkillsStoreContract} backed by the procedural memory tier
 * (`ai.memory({ procedural })`). **The unification** the design calls for:
 * "promote a proven procedural memory to a named skill" and "save a
 * self-authored skill" are the SAME machinery — one store, two entry
 * points. No fifth `MemoryTier` is added; the existing `"procedural"` tier
 * is reused verbatim.
 *
 * - `saveCandidate` ⇒ writes the candidate under its own key
 *   (`<namespace>.__skills__.candidate.<contentHash>.<name>`). A candidate
 *   never touches a live skill, so saving one under the name of a promoted
 *   skill leaves that skill catalogued and loadable.
 * - `promote(name, candidate?)` ⇒ copies the candidate to the live skill
 *   key with `type: "promoted"` and `version + 1`, records it in the
 *   catalog index, and re-remembers it in the procedural tier (which
 *   reinforces it, `uses++`). With `candidate` (the review gate passes the
 *   record it approved) only a stored candidate with that exact content is
 *   promoted.
 * - `list` reads the catalog index and `load` reads the live skill key —
 *   one cache `get` each, with no embedding call or similarity scan.
 *
 * Skills stored by an earlier release (one procedural memory per name,
 * found by similarity) are read once with a similarity recall and copied to
 * this layout the first time the index is missing.
 *
 * @example
 * const store = proceduralSkillStore({ embedder, store: cacheDriver });
 * const lib = skills({ name: "learned", sources: [{ type: "store", store }], review: gate });
 */
export function proceduralSkillStore(
  config: ProceduralMemoryConfig & { name?: string; recallQuery?: string },
): SkillsStoreContract {
  const store: MemoryContract = memory({
    name: config.name ?? "skills.procedural",
    working: false,
    defaultTier: "procedural",
    procedural: {
      embedder: config.embedder,
      store: config.store,
      namespace: config.namespace,
      reinforcementWeight: config.reinforcementWeight,
    },
  });

  // `memory()` above already threw when neither `store` nor a default
  // store exists, so this resolves.
  const driver = (config.store ?? resolveDefaultStore()) as CacheDriver<any, any>;
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;

  const indexKey = `${namespace}.__skills__.index`;
  const liveKey = (name: string): string => `${namespace}.__skills__.live.${name}`;
  const candidateKey = (name: string, hash: string): string =>
    `${namespace}.__skills__.candidate.${hash}.${name}`;
  const pointerKey = (name: string): string => `${namespace}.__skills__.pending.${name}`;

  // Skills written by an earlier release live only in the procedural tier,
  // found by similarity to a broad seed with a large `k` and a zero floor.
  const recallQuery = config.recallQuery ?? "skill procedure how-to";

  const recallAll = async (): Promise<ProceduralSkillEntry[]> => {
    const hits = await store.recall(recallQuery, {
      tier: "procedural",
      k: RECALL_K,
      threshold: 0,
    });

    return hits
      .map((hit) => ({ body: hit.text, meta: hit.metadata as ProceduralSkillMeta | undefined }))
      .filter((entry): entry is ProceduralSkillEntry => Boolean(entry.meta?.skill));
  };

  /** In-flight copy of earlier-release skills, shared by concurrent callers. */
  let migration: Promise<SkillIndex> | undefined;

  /**
   * Copy skills stored by an earlier release into this layout: promoted
   * skills to live keys and the index, candidates to candidate keys.
   */
  const migrateLegacy = (): Promise<SkillIndex> => {
    migration ??= (async () => {
      const entries = await recallAll();
      const skills: Record<string, ProceduralSkillMeta> = {};

      for (const entry of entries) {
        if (entry.meta.type === "candidate") {
          const hash = candidateContentHash(toRecord(entry.body, entry.meta));

          await driver.set(candidateKey(entry.meta.name, hash), entry);
          await driver.set(pointerKey(entry.meta.name), { hash } satisfies CandidatePointer);

          continue;
        }

        await driver.set(liveKey(entry.meta.name), entry);
        skills[entry.meta.name] = entry.meta;
      }

      const index = await driver.update<SkillIndex>(indexKey, (current) =>
        current?.layout === 2
          ? { layout: 2, skills: { ...skills, ...current.skills } }
          : { layout: 2, skills },
      );

      return index ?? { layout: 2, skills };
    })().finally(() => {
      migration = undefined;
    });

    return migration;
  };

  const readIndex = async (): Promise<SkillIndex> => {
    const index = await driver.get<SkillIndex>(indexKey);

    if (index?.layout === 2) {
      return index;
    }

    return migrateLegacy();
  };

  const readLive = async (name: string): Promise<ProceduralSkillEntry | undefined> => {
    const live = await driver.get<ProceduralSkillEntry>(liveKey(name));

    if (live) {
      return live;
    }

    // Unknown name — or skills not yet copied from an earlier release.
    if ((await driver.get<SkillIndex>(indexKey))?.layout === 2) {
      return undefined;
    }

    await migrateLegacy();

    return (await driver.get<ProceduralSkillEntry>(liveKey(name))) ?? undefined;
  };

  /**
   * Find the candidate a promotion applies to. With `reviewed` content,
   * only a stored candidate (or the live skill itself) with exactly that
   * content qualifies; without it, the latest candidate saved under the
   * name, else the live skill (a re-promotion).
   */
  const findPromotionSource = async (
    name: string,
    reviewed: Pick<SkillRecord, "description" | "body" | "tags"> | undefined,
  ): Promise<{ entry: ProceduralSkillEntry; candidateHash?: string } | undefined> => {
    if (reviewed) {
      const hash = candidateContentHash({ name, ...reviewed });
      const entry = await driver.get<ProceduralSkillEntry>(candidateKey(name, hash));

      if (entry) {
        return { entry, candidateHash: hash };
      }

      const live = await readLive(name);

      if (live && candidateContentHash(toRecord(live.body, live.meta)) === hash) {
        return { entry: live };
      }

      throw new Error(
        `proceduralSkillStore.promote: no stored candidate "${name}" matches the reviewed content — it was replaced or removed after review. Review the current candidate and promote it again.`,
      );
    }

    const pointer = await driver.get<CandidatePointer>(pointerKey(name));

    if (pointer) {
      const entry = await driver.get<ProceduralSkillEntry>(candidateKey(name, pointer.hash));

      if (entry) {
        return { entry, candidateHash: pointer.hash };
      }
    }

    const live = await readLive(name);

    return live ? { entry: live } : undefined;
  };

  return {
    async list(scope?: { tags?: string[] }): Promise<SkillCatalogEntry[]> {
      const index = await readIndex();
      const wanted = scope?.tags;

      return Object.values(index.skills)
        .filter((meta) => meta.type !== "candidate")
        .filter((meta) => intersects(meta.tags, wanted))
        .map((meta) => toCatalogEntry(meta));
    },
    async load(name: string, version?: number): Promise<SkillRecord | undefined> {
      const match = await readLive(name);

      if (!match || match.meta.type === "candidate") {
        return undefined;
      }

      if (version !== undefined && match.meta.version !== version) {
        return undefined;
      }

      return toRecord(match.body, match.meta);
    },
    async saveCandidate(record: Omit<SkillRecord, "version" | "type">): Promise<SkillRecord> {
      const meta: ProceduralSkillMeta = {
        skill: true,
        name: record.name,
        type: "candidate",
        description: record.description,
        version: 0,
        tags: record.tags,
      };
      const hash = candidateContentHash(record);
      const entry: ProceduralSkillEntry = { body: record.body, meta };

      await driver.set(candidateKey(record.name, hash), entry);
      await driver.set(pointerKey(record.name), { hash } satisfies CandidatePointer);

      return { ...record, version: 0, type: "candidate" };
    },
    async promote(
      name: string,
      candidate?: Pick<SkillRecord, "description" | "body" | "tags">,
    ): Promise<SkillRecord> {
      // Copies earlier-release skills first, so the index update below
      // never hides them.
      await readIndex();

      const source = await findPromotionSource(name, candidate);

      if (!source) {
        throw new Error(`proceduralSkillStore.promote: no skill named "${name}" to promote`);
      }

      const live = await readLive(name);
      const meta: ProceduralSkillMeta = {
        ...source.entry.meta,
        type: "promoted",
        version: Math.max(live?.meta.version ?? 0, source.entry.meta.version) + 1,
      };

      await driver.set(liveKey(name), { body: source.entry.body, meta });
      await driver.update<SkillIndex>(indexKey, (current) => ({
        layout: 2,
        skills: { ...(current?.layout === 2 ? current.skills : {}), [name]: meta },
      }));

      // Re-remembering the same id reinforces (uses++) in the procedural
      // tier, so the skill stays a recallable procedure.
      await store.remember({
        id: name,
        text: source.entry.body,
        tier: "procedural",
        metadata: meta,
      });

      if (source.candidateHash !== undefined) {
        await driver.remove(candidateKey(name, source.candidateHash));

        const pointer = await driver.get<CandidatePointer>(pointerKey(name));

        if (pointer?.hash === source.candidateHash) {
          await driver.remove(pointerKey(name));
        }
      }

      return toRecord(source.entry.body, meta);
    },
  };
}

function toCatalogEntry(meta: ProceduralSkillMeta): SkillCatalogEntry {
  return {
    name: meta.name,
    description: meta.description,
    version: meta.version,
    tags: meta.tags,
    type: meta.type,
  };
}

function toRecord(body: string, meta: ProceduralSkillMeta): SkillRecord {
  return {
    name: meta.name,
    description: meta.description,
    version: meta.version,
    body,
    tags: meta.tags,
    type: meta.type,
  };
}

function intersects(recordTags: string[] | undefined, wanted: string[] | undefined): boolean {
  if (!wanted || wanted.length === 0) {
    return true;
  }

  if (!recordTags || recordTags.length === 0) {
    return false;
  }

  return recordTags.some((tag) => wanted.includes(tag));
}
