import { hashText, stableJson } from "../../utils/hash-text";
import type { SkillRecord } from "../contracts/skill-record.type";

/** The reviewed content of a candidate — what a promotion must match. */
export type CandidateContent = Pick<SkillRecord, "name" | "description" | "body" | "tags">;

/**
 * Stable hash of a candidate's reviewable content (name, description,
 * body, tags). Two candidates hash equal exactly when a reviewer would see
 * the same skill, so a promotion can be bound to the content that was
 * approved. Version, provenance and metadata are not part of it.
 */
export function candidateContentHash(content: CandidateContent): string {
  return hashText(
    stableJson({
      name: content.name,
      description: content.description,
      body: content.body,
      tags: content.tags ?? [],
    }),
  );
}
