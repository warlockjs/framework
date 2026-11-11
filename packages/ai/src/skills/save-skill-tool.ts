import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ToolContract } from "../tool/tool";
import { tool } from "../tool/tool";
import type { SkillRecord } from "./contracts/skill-record.type";

/** Validated input of the `saveSkill` tool. */
export type SaveSkillInput = {
  name: string;
  description: string;
  body: string;
  tags?: string[];
};

/** Result the `saveSkill` tool feeds back to the model. */
export type SaveSkillResult =
  | { saved: true; name: string; status: "candidate" }
  | { error: string };

/**
 * Size limits on a model-proposed skill. A candidate is stored and later
 * shown to a reviewer (and, once promoted, injected into prompts), so the
 * model cannot write arbitrarily large or oddly named records.
 */
const SAVE_SKILL_LIMITS = {
  /** Name: 1–64 characters, letters, digits, `-` and `_`, starting with a letter or digit. */
  name: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,
  /** Maximum description length, in characters. */
  description: 500,
  /** Maximum body length, in characters. */
  body: 16_384,
  /** Maximum number of tags. */
  tags: 10,
  /** Maximum length of one tag, in characters. */
  tag: 32,
} as const;

/**
 * Return a message naming the first limit `input` breaks, or `undefined`
 * when it is within every {@link SAVE_SKILL_LIMITS} bound.
 */
function limitIssue(input: SaveSkillInput): string | undefined {
  if (!SAVE_SKILL_LIMITS.name.test(input.name)) {
    return "saveSkill `name` must be 1-64 characters of letters, digits, '-' or '_', starting with a letter or digit";
  }

  if (input.description.length > SAVE_SKILL_LIMITS.description) {
    return `saveSkill \`description\` must be at most ${SAVE_SKILL_LIMITS.description} characters`;
  }

  if (input.body.length > SAVE_SKILL_LIMITS.body) {
    return `saveSkill \`body\` must be at most ${SAVE_SKILL_LIMITS.body} characters`;
  }

  if (input.tags && input.tags.length > SAVE_SKILL_LIMITS.tags) {
    return `saveSkill \`tags\` may hold at most ${SAVE_SKILL_LIMITS.tags} tags`;
  }

  if (input.tags?.some((tag) => tag.length === 0 || tag.length > SAVE_SKILL_LIMITS.tag)) {
    return `saveSkill each tag must be 1-${SAVE_SKILL_LIMITS.tag} characters`;
  }

  return undefined;
}

/**
 * Hand-built Standard Schema for the `saveSkill` input — dependency-free,
 * mirroring `loadSkillSchema`. Requires `name` / `description` / `body`;
 * `tags` is an optional string array. Enforces {@link SAVE_SKILL_LIMITS}.
 */
function saveSkillSchema(): StandardSchemaV1<SaveSkillInput> {
  return {
    "~standard": {
      version: 1,
      vendor: "warlock-ai-skills",
      validate: (value: unknown) => {
        const candidate = value as {
          name?: unknown;
          description?: unknown;
          body?: unknown;
          tags?: unknown;
        } | null;

        if (
          !candidate ||
          typeof candidate.name !== "string" ||
          typeof candidate.description !== "string" ||
          typeof candidate.body !== "string"
        ) {
          return {
            issues: [
              {
                message:
                  "saveSkill input must be { name: string; description: string; body: string; tags?: string[] }",
              },
            ],
          };
        }

        if (
          candidate.tags !== undefined &&
          (!Array.isArray(candidate.tags) ||
            !candidate.tags.every((tag) => typeof tag === "string"))
        ) {
          return { issues: [{ message: "saveSkill `tags` must be a string[] when provided" }] };
        }

        const input: SaveSkillInput = {
          name: candidate.name,
          description: candidate.description,
          body: candidate.body,
          ...(candidate.tags !== undefined ? { tags: candidate.tags as string[] } : {}),
        };
        const issue = limitIssue(input);

        if (issue !== undefined) {
          return { issues: [{ message: issue }] };
        }

        return { value: input };
      },
    },
  };
}

/** Dependencies the `saveSkill` tool closes over. */
export type SaveSkillToolDeps = {
  /** Write an INERT candidate; the returned record is `type: "candidate"`. */
  saveCandidate: (record: Omit<SkillRecord, "version" | "type">) => Promise<SkillRecord>;
  /** Fired on a successful save (`type: "saved"`); errors swallowed by the sink wrapper. */
  onSaved?: (record: SkillRecord) => void;
};

/**
 * Build the **Phase 2** `saveSkill` tool — exposed ONLY when a `review`
 * gate is configured. It writes an INERT `type: "candidate"` record via
 * `saveCandidate`. A candidate is filtered out of the catalog and from
 * preload — it can NEVER be injected until the default-DENY review gate
 * promotes it. So `saveSkill` alone can never turn the model's own output
 * into an injected instruction; promotion is a separate, gated step.
 *
 * `execute` never throws — a store write failure surfaces as an error
 * result so the run continues.
 */
export function saveSkillTool(
  deps: SaveSkillToolDeps,
): ToolContract<SaveSkillInput, SaveSkillResult> {
  return tool<SaveSkillInput, SaveSkillResult>({
    name: "saveSkill",
    description:
      "Propose a new reusable skill. The skill is saved as an INERT candidate and is NOT used until a reviewer approves it — it will not affect the current run.",
    input: saveSkillSchema(),
    execute: async (input) => {
      try {
        const record = await deps.saveCandidate({
          name: input.name,
          description: input.description,
          body: input.body,
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        });

        deps.onSaved?.(record);

        return { saved: true, name: record.name, status: "candidate" };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
