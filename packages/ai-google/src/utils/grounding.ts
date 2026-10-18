import type { GenerateContentResponse, GroundingMetadata } from "@google/genai";
import type { Usage } from "@warlock.js/ai";

/** Candidate snapshots are replaced, not added: streamed metadata may repeat.
 * Installed @google/genai 2.19.0 GroundingMetadata.webSearchQueries; REST schema:
 * https://ai.google.dev/api/generate-content#GroundingMetadata
 * Billing ignores empty queries and counts unique queries for Gemini 3+:
 * https://ai.google.dev/gemini-api/docs/google-search#pricing
 * Gemini 2.5 and older bill per grounded prompt; this counter is NOT that unit. */
export function applyGrounding(
  usage: Usage,
  snapshots: Map<number, GroundingMetadata>,
  response: GenerateContentResponse,
): void {
  for (const [position, candidate] of (response.candidates ?? []).entries()) {
    if (candidate.groundingMetadata)
      snapshots.set(candidate.index ?? position, candidate.groundingMetadata);
  }
  const reported = [...snapshots.values()].filter(
    (metadata) => metadata.webSearchQueries !== undefined,
  );
  if (reported.length > 0) {
    const queries = reported.flatMap((metadata) => metadata.webSearchQueries ?? []);
    usage.serverToolUse = {
      ...usage.serverToolUse,
      webSearchRequests: new Set(queries.filter((query) => query !== "")).size,
      googleWebSearchQueries: queries.length,
    };
  }
}

/** Retain chunks, supports, search entry point and queries without flattening them. */
export function groundingMetadata(
  snapshots: Map<number, GroundingMetadata>,
): Record<string, unknown> | undefined {
  return snapshots.size
    ? {
        google: {
          groundingMetadata: [...snapshots].map(([index, metadata]) => ({ index, ...metadata })),
        },
      }
    : undefined;
}
